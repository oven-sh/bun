/**
 * Ninja build file writer.
 *
 * Reference: https://ninja-build.org/manual.html
 *
 * The core primitive of the build system. Everything else (compile, link, codegen,
 * external builds) is a constructor that produces BuildNodes, which map 1:1 to
 * ninja `build` statements.
 */

import { mkdir } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { BuildError, assert } from "./error.ts";
import { writeIfChanged } from "./fs.ts";
import { quote, quoteWin32Argv } from "./shell.ts";

/**
 * A ninja `rule` — a reusable command template.
 */
export interface Rule {
  /** The shell command. Use $in, $out, and custom vars like $flags. */
  command: string;
  /** Human-readable description printed during build (e.g. "CXX $out"). */
  description?: string;
  /** Path to gcc-style depfile ($out.d), enables header dependency tracking. */
  depfile?: string;
  /** Depfile format. Use "gcc" for clang/gcc, "msvc" for clang-cl. */
  deps?: "gcc" | "msvc";
  /** Re-stat outputs after command; prunes downstream rebuilds if output unchanged. */
  restat?: boolean;
  /**
   * Marks this as a generator rule. Ninja won't consider itself dirty when only
   * the command line of a generator rule changes. Used for the reconfigure rule.
   */
  generator?: boolean;
  /** Job pool for parallelism control (e.g. "console" for stdout access). */
  pool?: string;
  /** Response file path. Needed when command line would exceed OS limits. */
  rspfile?: string;
  /** Content written to rspfile (usually $in or $in_newline). */
  rspfile_content?: string;
}

/**
 * A ninja `build` statement — the only primitive of the build graph.
 *
 * Inputs → command (from rule) → outputs.
 */
export interface BuildNode {
  /** Files this build produces. Must not be empty. */
  outputs: string[];
  /** Additional outputs that ninja tracks but that don't appear in $out. */
  implicitOutputs?: string[];
  /** The rule to use (name of a previously registered rule, or "phony"). */
  rule: string;
  /** Explicit inputs. Available as $in in the rule command. */
  inputs: string[];
  /**
   * Implicit inputs (ninja `| dep` syntax). Tracked for staleness but not in $in.
   * Use for: generated headers, the PCH file, dep library outputs.
   */
  implicitInputs?: string[];
  /**
   * Order-only inputs (ninja `|| dep` syntax). Must exist before this builds,
   * but their mtime is ignored. Use for: directory creation, phony groupings.
   */
  orderOnlyInputs?: string[];
  /** Variable bindings local to this build statement. */
  vars?: Record<string, string>;
  /** Job pool override (overrides rule's pool). */
  pool?: string;
}

/**
 * A compile_commands.json entry.
 */
export interface CompileCommand {
  directory: string;
  file: string;
  /** Optional per the JSON Compilation Database spec; omitted for entries that exist only for clangd (unified-source originals). */
  output?: string;
  arguments: string[];
}

export interface NinjaOptions {
  /** Absolute path to build directory. All paths in build.ninja are relative to this. */
  buildDir: string;
  /** Minimum ninja version to require. */
  ninjaVersion?: string;
  /** Host runs cmd.exe (affects how native tasks are quoted in build.ninja). Default: this process's platform. */
  hostWindows?: boolean;
}

/**
 * A `build()` statement as retained in memory for the engine bridge
 * (`bridge.ts`). Same shape as `BuildNode`, but every path is already
 * buildDir-relative and unescaped, and the rule is resolved. `build.ninja`
 * is the serialized form of this list.
 */
export interface GraphEdge {
  readonly id: number;
  readonly rule: string;
  readonly outputs: readonly string[];
  readonly implicitOutputs: readonly string[];
  readonly inputs: readonly string[];
  readonly implicitInputs: readonly string[];
  readonly orderOnlyInputs: readonly string[];
  readonly vars: Readonly<Record<string, string>>;
  /** Effective pool: the edge override, else the rule's pool, else "" (none). */
  readonly pool: string;
}

/** One program invocation inside a `NativeTask`. argv paths are as the tool sees them (cwd-relative or absolute). */
export interface NativeCommand {
  argv: string[];
  /** Working directory. Default: the build dir. */
  cwd?: string | undefined;
  /** Extra environment on top of the build's. */
  env?: Record<string, string> | undefined;
}

/**
 * A task declared with `Ninja.task()`: the native form, which the engine runs
 * as-is (`engine.ts`). Paths are absolute. Unlike `BuildNode` there is no
 * rule, no `$var` template, and no shell: the command is argv plus cwd/env.
 * `toString()` still serializes it for `--runner=ninja`, with the shell
 * quoting done in one place here instead of in every emitter.
 */
export interface NativeTask {
  /** Display group: "cxx", "link", "fetch", … Also the exported rule name. */
  kind: string;
  /** Shown while running: the main output, or the dep name. */
  label: string;
  /** Runs in order; stops at the first failure. */
  commands: NativeCommand[];
  outputs: string[];
  /** Outputs the engine tracks that are not the main product (linker maps, the PCH stub object). */
  implicitOutputs?: string[] | undefined;
  /** Inputs the command consumes. These are also the response file's lines when `rspfile` is set. */
  inputs: string[];
  /** Inputs tracked for staleness only (the PCH, a dep's .a, a symbol list). */
  implicitInputs?: string[] | undefined;
  /** Must exist first, mtime ignored: generated headers (the depfile tracks the ones really read), dir stamps. Paths or phony names. */
  after?: string[] | undefined;
  depfile?: { kind: "gcc"; path: string } | { kind: "msvc" } | undefined;
  /** Response file: `inputs`, one per line. For linkers and archivers. */
  rspfile?: string | undefined;
  /** Outputs may be identical after a run; only a moved mtime is a change. */
  restat?: boolean | undefined;
  /** Run every build; the command tracks its own staleness (cargo, cmake). */
  alwaysRun?: boolean | undefined;
  pool?: string | undefined;
  /** Owns the terminal while it runs. */
  console?: boolean | undefined;
}

/**
 * Build recorder and ninja file writer.
 *
 * Two ways to declare work, both retained in memory and both serializable to
 * `build.ninja`:
 * - `task()`: the native form (argv, cwd, env). New code uses this.
 * - `rule()` + `build()`: ninja rule templates. The not-yet-ported emitters
 *   use these; `bridge.ts` expands them for the engine.
 *
 * All paths given to this class should be ABSOLUTE. They are converted to
 * buildDir-relative at write time via `rel()`.
 */
export class Ninja {
  readonly buildDir: string;
  private readonly ninjaVersion: string;

  private readonly lines: string[] = [];
  private readonly ruleNames = new Set<string>();
  private readonly outputSet = new Set<string>();
  private readonly pools = new Map<string, number>();
  private readonly defaults: string[] = [];
  private readonly compileCommands: CompileCommand[] = [];

  // Structured copy of everything written to `lines`, for the engine.
  // `build.ninja` stays the serialized form of the same data.
  private readonly ruleSpecs = new Map<string, Rule>();
  private readonly edgeList: GraphEdge[] = [];
  private readonly nativeTasks: NativeTask[] = [];
  /** Host shell dialect for the exported `$cmd` of native tasks. */
  private readonly hostWindows: boolean;

  constructor(opts: NinjaOptions) {
    assert(isAbsolute(opts.buildDir), `Ninja buildDir must be absolute, got: ${opts.buildDir}`);
    this.buildDir = resolve(opts.buildDir);
    // 1.9 is the minimum we need — implicit outputs (1.7), console pool
    // (1.5), restat (1.0). We don't use dyndep (1.10's headline feature).
    // Some CI agents (darwin) ship 1.9 and we don't control their image.
    this.ninjaVersion = opts.ninjaVersion ?? "1.9";
    this.hostWindows = opts.hostWindows ?? process.platform === "win32";
  }

  /**
   * Convert an absolute path to buildDir-relative.
   * Idempotent on already-relative paths.
   */
  rel(path: string): string {
    if (!isAbsolute(path)) {
      return path;
    }
    return relative(this.buildDir, path);
  }

  /** Define a top-level ninja variable. */
  variable(name: string, value: string): void {
    assert(/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name), `Invalid ninja variable name: ${name}`);
    this.lines.push(`${name} = ${ninjaEscapeVarValue(value)}`);
  }

  /** Add a comment line to the output. */
  comment(text: string): void {
    for (const line of text.split("\n")) {
      this.lines.push(`# ${line}`);
    }
  }

  /** Add a blank line for readability. */
  blank(): void {
    this.lines.push("");
  }

  /** Define a ninja pool for parallelism control. */
  pool(name: string, depth: number): void {
    assert(!this.pools.has(name), `Duplicate pool: ${name}`);
    assert(depth >= 1, `Pool depth must be >= 1, got: ${depth}`);
    this.pools.set(name, depth);
  }

  /** Define a ninja rule. */
  rule(name: string, spec: Rule): void {
    assert(/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name), `Invalid ninja rule name: ${name}`);
    assert(!this.ruleNames.has(name), `Duplicate rule: ${name}`);
    this.ruleNames.add(name);
    this.ruleSpecs.set(name, { ...spec });

    this.lines.push(`rule ${name}`);
    this.lines.push(`  command = ${spec.command}`);
    if (spec.description !== undefined) {
      this.lines.push(`  description = ${spec.description}`);
    }
    if (spec.depfile !== undefined) {
      this.lines.push(`  depfile = ${spec.depfile}`);
    }
    if (spec.deps !== undefined) {
      this.lines.push(`  deps = ${spec.deps}`);
    }
    if (spec.restat === true) {
      this.lines.push(`  restat = 1`);
    }
    if (spec.generator === true) {
      this.lines.push(`  generator = 1`);
    }
    if (spec.pool !== undefined) {
      this.lines.push(`  pool = ${spec.pool}`);
    }
    if (spec.rspfile !== undefined) {
      this.lines.push(`  rspfile = ${spec.rspfile}`);
    }
    if (spec.rspfile_content !== undefined) {
      this.lines.push(`  rspfile_content = ${spec.rspfile_content}`);
    }
    this.lines.push("");
  }

  /**
   * Add a build statement. The core of the graph.
   *
   * All paths in `node` should be absolute; they are converted to
   * buildDir-relative automatically.
   */
  build(node: BuildNode): void {
    assert(node.outputs.length > 0, `Build node must have at least one output (rule: ${node.rule})`);
    assert(node.rule === "phony" || this.ruleNames.has(node.rule), `Unknown rule: ${node.rule}`, {
      hint: `Define the rule with ninja.rule("${node.rule}", {...}) first`,
    });

    // Check for duplicate outputs
    const allOuts = [...node.outputs, ...(node.implicitOutputs ?? [])];
    for (const out of allOuts) {
      const abs = isAbsolute(out) ? resolve(out) : resolve(this.buildDir, out);
      if (this.outputSet.has(abs)) {
        throw new BuildError(`Duplicate build output: ${out}`, {
          hint: "Another build statement already produces this file",
        });
      }
      this.outputSet.add(abs);
    }

    const relOuts = node.outputs.map(p => this.rel(p));
    const relImplOuts = (node.implicitOutputs ?? []).map(p => this.rel(p));
    const relIns = node.inputs.map(p => this.rel(p));
    const relImplIns = (node.implicitInputs ?? []).map(p => this.rel(p));
    const relOrderIns = (node.orderOnlyInputs ?? []).map(p => this.rel(p));

    this.edgeList.push({
      id: this.edgeList.length,
      rule: node.rule,
      outputs: relOuts,
      implicitOutputs: relImplOuts,
      inputs: relIns,
      implicitInputs: relImplIns,
      orderOnlyInputs: relOrderIns,
      vars: { ...(node.vars ?? {}) },
      pool: node.pool ?? this.ruleSpecs.get(node.rule)?.pool ?? "",
    });

    const outs = relOuts.map(ninjaEscapePath);
    const implOuts = relImplOuts.map(ninjaEscapePath);
    const ins = relIns.map(ninjaEscapePath);
    const implIns = relImplIns.map(ninjaEscapePath);
    const orderIns = relOrderIns.map(ninjaEscapePath);

    let line = `build ${outs.join(" ")}`;
    if (implOuts.length > 0) {
      line += ` | ${implOuts.join(" ")}`;
    }
    line += `: ${node.rule}`;
    if (ins.length > 0) {
      line += ` ${ins.join(" ")}`;
    }
    if (implIns.length > 0) {
      line += ` | ${implIns.join(" ")}`;
    }
    if (orderIns.length > 0) {
      line += ` || ${orderIns.join(" ")}`;
    }

    // Wrap long lines with $\n continuations for readability
    this.lines.push(wrapLongLine(line));

    if (node.pool !== undefined) {
      this.lines.push(`  pool = ${node.pool}`);
    }
    if (node.vars !== undefined) {
      for (const [k, v] of Object.entries(node.vars)) {
        this.lines.push(`  ${k} = ${ninjaEscapeVarValue(v)}`);
      }
    }
    this.lines.push("");
  }

  /** Shorthand for a phony target (groups other targets). */
  phony(name: string, deps: string[]): void {
    this.build({
      outputs: [name],
      rule: "phony",
      inputs: deps,
    });
  }

  /**
   * Returns an always-dirty phony target. Depending on this forces a rule
   * to re-run every build. Useful for nested builds (cmake/cargo) where the
   * inner build system tracks its own staleness — we always invoke it, it
   * no-ops if nothing changed, `restat=1` on the outer rule prunes downstream.
   *
   * Emitted lazily on first call; subsequent calls return the same name.
   */
  always(): string {
    const name = "always";
    // outputSet stores absolute paths; phony targets resolve relative to buildDir.
    const abs = resolve(this.buildDir, name);
    if (!this.outputSet.has(abs)) {
      // A phony with no inputs is always dirty (its output file never exists).
      this.phony(name, []);
    }
    return name;
  }

  /** Mark targets as default (built when running `ninja` with no args). */
  default(targets: string[]): void {
    for (const t of targets) {
      this.defaults.push(this.rel(t));
    }
  }

  /**
   * Declare a native task. Outputs must be unique across the whole build.
   * Serialized to build.ninja as a rule named after `kind` (see
   * `nativeRuleName`) with the shell-quoted command in `$cmd`.
   */
  task(t: NativeTask): void {
    assert(t.outputs.length > 0, `task '${t.kind} ${t.label}' must have at least one output`);
    assert(t.commands.length > 0, `task '${t.kind} ${t.label}' must have a command`);
    assert(/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(t.kind), `Invalid task kind: ${t.kind}`);
    for (const out of [...t.outputs, ...(t.implicitOutputs ?? [])]) {
      const abs = resolve(this.buildDir, out);
      if (this.outputSet.has(abs)) {
        throw new BuildError(`Duplicate build output: ${out}`, {
          hint: "Another build statement already produces this file",
        });
      }
      this.outputSet.add(abs);
    }
    this.nativeTasks.push(t);
  }

  // ─── Structured graph access (for bridge.ts) ───

  /** Every `build()` statement, in emission order. Paths are buildDir-relative. */
  get edges(): readonly GraphEdge[] {
    return this.edgeList;
  }

  /** Every `task()` declaration, in emission order. Paths are absolute. */
  get tasks(): readonly NativeTask[] {
    return this.nativeTasks;
  }

  /** The rule a build statement refers to. "phony" has no spec. */
  getRule(name: string): Rule | undefined {
    return this.ruleSpecs.get(name);
  }

  /** Declared pools. "console" is implicit (depth 1) and not listed here. */
  get poolDepths(): ReadonlyMap<string, number> {
    return this.pools;
  }

  /** Default targets, buildDir-relative. */
  get defaultTargets(): readonly string[] {
    return this.defaults;
  }

  /**
   * Record a compile command for compile_commands.json.
   * Called by `cxx()` and `cc()` in compile.ts.
   */
  addCompileCommand(cmd: CompileCommand): void {
    this.compileCommands.push(cmd);
  }

  /**
   * Serialize to ninja file content (without writing to disk).
   */
  toString(): string {
    const header: string[] = [
      `# Generated by scripts/build/configure.ts`,
      `# DO NOT EDIT — changes will be overwritten on next configure`,
      ``,
      `ninja_required_version = ${this.ninjaVersion}`,
      ``,
    ];

    const poolLines: string[] = [];
    for (const [name, depth] of this.pools) {
      poolLines.push(`pool ${name}`);
      poolLines.push(`  depth = ${depth}`);
      poolLines.push("");
    }

    const defaultLines: string[] =
      this.defaults.length > 0 ? [`default ${this.defaults.map(ninjaEscapePath).join(" ")}`, ""] : [];

    return [...header, ...poolLines, ...this.lines, ...this.nativeLines(), ...defaultLines].join("\n");
  }

  /**
   * Native tasks as ninja text. One rule per distinct (kind, depfile, restat,
   * rspfile, pool) combination; the command itself is a per-edge `$cmd`.
   */
  private nativeLines(): string[] {
    const lines: string[] = [];
    const rules = new Map<string, string>();
    let usesAlways = false;
    for (const t of this.nativeTasks) {
      const pool = t.console ? "console" : t.pool;
      const key = JSON.stringify([t.kind, t.depfile?.kind, t.restat === true, t.rspfile !== undefined, pool]);
      let name = rules.get(key);
      if (name === undefined) {
        name = nativeRuleName(t.kind, [...rules.values()], this.ruleNames);
        rules.set(key, name);
        lines.push(`rule ${name}`, `  command = $cmd`, `  description = $desc`);
        if (t.depfile?.kind === "gcc") lines.push(`  depfile = $depfile`, `  deps = gcc`);
        if (t.depfile?.kind === "msvc") lines.push(`  deps = msvc`);
        if (t.restat === true) lines.push(`  restat = 1`);
        if (t.rspfile !== undefined) lines.push(`  rspfile = $rspfile`, `  rspfile_content = $in_newline`);
        if (pool !== undefined) lines.push(`  pool = ${pool}`);
        lines.push("");
      }
      const esc = (p: string) => ninjaEscapePath(this.rel(p));
      let line = `build ${t.outputs.map(esc).join(" ")}`;
      if (t.implicitOutputs?.length) line += ` | ${t.implicitOutputs.map(esc).join(" ")}`;
      line += `: ${name}`;
      if (t.inputs.length > 0) line += ` ${t.inputs.map(esc).join(" ")}`;
      if (t.implicitInputs?.length) line += ` | ${t.implicitInputs.map(esc).join(" ")}`;
      const after = [...(t.after ?? [])];
      if (t.alwaysRun === true) {
        after.push("always");
        usesAlways = true;
      }
      if (after.length > 0) line += ` || ${after.map(esc).join(" ")}`;
      lines.push(wrapLongLine(line));
      lines.push(`  cmd = ${ninjaEscapeVarValue(this.shellCommand(t.commands))}`);
      lines.push(`  desc = ${ninjaEscapeVarValue(`${t.kind} ${t.label}`)}`);
      if (t.depfile?.kind === "gcc") lines.push(`  depfile = ${ninjaEscapeVarValue(this.rel(t.depfile.path))}`);
      if (t.rspfile !== undefined) lines.push(`  rspfile = ${ninjaEscapeVarValue(this.rel(t.rspfile))}`);
      lines.push("");
    }
    if (usesAlways && !this.outputSet.has(resolve(this.buildDir, "always"))) {
      lines.push("build always: phony", "");
    }
    return lines;
  }

  /**
   * The shell text ninja runs for a native task. posix: `cd X && K=V prog
   * args && …`. Windows host: ninja hands the line to CreateProcess, so a cwd,
   * env, or chain needs `cmd /c "…"`; a bare argv goes through verbatim with
   * CommandLineToArgvW quoting (cmd leaves `\"` alone, so the same quoting
   * works inside the wrapper).
   */
  private shellCommand(commands: NativeCommand[]): string {
    const win = this.hostWindows;
    const parts = commands.map(c => {
      let s = "";
      if (c.cwd !== undefined) s += win ? `cd /d ${quote(c.cwd, true)} && ` : `cd ${quote(c.cwd, false)} && `;
      for (const [k, v] of Object.entries(c.env ?? {})) s += win ? `set ${k}=${v}&& ` : `${k}=${quote(v, false)} `;
      return s + c.argv.map(a => (win ? quoteWin32Argv(a) : quote(a, false))).join(" ");
    });
    const joined = parts.join(" && ");
    const needsShell = commands.length > 1 || commands.some(c => c.cwd !== undefined || c.env !== undefined);
    return win && needsShell ? `cmd /c "${joined}"` : joined;
  }

  /**
   * Write build.ninja and compile_commands.json to buildDir.
   *
   * Returns `true` if build.ninja content changed (or didn't exist).
   * Caller can use this to decide whether to print configure output —
   * on an unchanged re-configure (same flags, same sources), stay quiet.
   */
  async write(): Promise<boolean> {
    await mkdir(this.buildDir, { recursive: true });

    // Only write files whose content actually changed — preserves mtimes
    // for idempotent re-configures. A ninja run after an unchanged
    // reconfigure sees nothing new and stays a true no-op. Without this,
    // we'd touch build.ninja every time, which is harmless for ninja
    // itself (it tracks content via .ninja_log) but wasteful and makes
    // `ls -lt build/` less useful for debugging.
    const changed = writeIfChanged(resolve(this.buildDir, "build.ninja"), this.toString());

    writeIfChanged(
      resolve(this.buildDir, "compile_commands.json"),
      JSON.stringify(this.compileCommands, null, 2) + "\n",
    );

    return changed;
  }
}

// ---------------------------------------------------------------------------
// Ninja escaping
//
// Ninja has two escaping contexts:
// 1. Paths in build lines: $ and space must be escaped with $
// 2. Variable values: only $ needs escaping (newlines need $\n but we don't emit those)
// ---------------------------------------------------------------------------

/** `kind`, or `kind_2`, `kind_3`… when the same kind needs several rule variants. Never a legacy rule's name. */
function nativeRuleName(kind: string, taken: string[], legacy: Set<string>): string {
  let name = kind;
  for (let i = 2; taken.includes(name) || legacy.has(name); i++) name = `${kind}_${i}`;
  return name;
}

/** Escape a path for use in a `build` line. */
function ninjaEscapePath(path: string): string {
  return path.replace(/\$/g, "$$$$").replace(/ /g, "$ ").replace(/:/g, "$:");
}

/** Escape a value for use on the right side of `var = value`. */
function ninjaEscapeVarValue(value: string): string {
  return value.replace(/\$/g, "$$$$");
}

/**
 * Wrap a long `build` line using ninja's $\n continuation.
 * Purely cosmetic — ninja handles arbitrarily long lines, but humans don't.
 */
function wrapLongLine(line: string, width = 120): string {
  if (line.length <= width) {
    return line;
  }
  // Split at spaces (that aren't escaped), wrap with $\n + 4-space indent
  const parts = line.split(/(?<=[^$]) /);
  const out: string[] = [];
  let current = parts[0]!;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]!;
    if (current.length + 1 + part.length > width) {
      out.push(current + " $");
      current = "    " + part;
    } else {
      current += " " + part;
    }
  }
  out.push(current);
  return out.join("\n");
}
