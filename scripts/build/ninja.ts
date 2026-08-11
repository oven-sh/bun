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
  /**
   * Scheduling hint — see `SchedulePriority`. Ninja ranks ready edges by how
   * many edges still follow them (the same for every compile, for cargo, and
   * for every dep object: one link) and breaks the tie by position in
   * build.ninja, so the order statements are written in is the order ninja
   * starts them in. Statements with a priority are written ahead of
   * everything else, highest first; statements without one keep emission
   * order. Pure ordering: no effect on what gets built or on the command
   * hashes in .ninja_log.
   */
  priority?: number;
}

/**
 * Priorities for the edges that decide a fresh build's wall-clock time, so
 * they start as soon as their inputs exist instead of after the ~1100 dep
 * objects emitted before them. Measured on cold release builds: cargo, the
 * longest edge in every profile, started 13s after its codegen inputs were
 * ready on a 12-core machine and ~190s after on a 6-slot one; the generated
 * TUs are emitted last, so ZigGeneratedClasses.cpp.o (27s) was the last
 * compile to start and the C++ side finished ~10s after every other object
 * was done. Tiers follow the measured durations: cargo (minutes) > unified
 * bundles (3-70s, emitted largest first) > generated TUs (8-27s; they don't
 * exist at configure time, so no size to sort by) > standalone bun sources
 * (2-40s, largest first) > everything unprioritized (dep objects, mostly
 * well under a second each, which pack in around the long edges). The one
 * long dep object, sqlite3.c (84s), waits for nothing and was reached 12s
 * into the build even on 12 cores, so it gets by without a priority.
 */
export const SchedulePriority = {
  cargo: 400,
  unifiedBundle: 300,
  generatedTu: 200,
  standaloneTu: 100,
} as const;

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
}

/**
 * Ninja build file writer.
 *
 * Accumulates rules, build statements, variables, pools. Call `write()` to emit
 * `build.ninja` + `compile_commands.json`.
 *
 * All paths given to this class should be ABSOLUTE. They are converted to
 * buildDir-relative at write time via `rel()`.
 */
export class Ninja {
  readonly buildDir: string;
  private readonly ninjaVersion: string;

  private readonly lines: string[] = [];
  /**
   * `rule` blocks and top-level variables. Written before every build
   * statement, so where a statement ends up in the file (which `priority`
   * changes) never affects which rules and variables it can see.
   */
  private readonly declarations: string[] = [];
  /** Build statements with a `priority`, written ahead of `lines` (see BuildNode.priority). */
  private readonly prioritized: { priority: number; text: string }[] = [];
  private readonly ruleNames = new Set<string>();
  private readonly variableNames = new Set<string>();
  private readonly outputSet = new Set<string>();
  private readonly pools = new Map<string, number>();
  private readonly defaults: string[] = [];
  private readonly compileCommands: CompileCommand[] = [];

  constructor(opts: NinjaOptions) {
    assert(isAbsolute(opts.buildDir), `Ninja buildDir must be absolute, got: ${opts.buildDir}`);
    this.buildDir = resolve(opts.buildDir);
    // 1.9 is the minimum we need — implicit outputs (1.7), console pool
    // (1.5), restat (1.0). We don't use dyndep (1.10's headline feature).
    // Some CI agents (darwin) ship 1.9 and we don't control their image.
    this.ninjaVersion = opts.ninjaVersion ?? "1.9";
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

  /**
   * Define a top-level ninja variable. Visible to every build statement
   * regardless of emission order (see `declarations`), which is also why a
   * name can only be defined once: ninja would otherwise give statements
   * different values depending on where they land in the file.
   */
  variable(name: string, value: string): void {
    assert(/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name), `Invalid ninja variable name: ${name}`);
    assert(!this.variableNames.has(name), `Duplicate ninja variable: ${name}`);
    this.variableNames.add(name);
    this.declarations.push(`${name} = ${ninjaEscapeVarValue(value)}`, "");
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

    const out = this.declarations;
    out.push(`rule ${name}`);
    out.push(`  command = ${spec.command}`);
    if (spec.description !== undefined) {
      out.push(`  description = ${spec.description}`);
    }
    if (spec.depfile !== undefined) {
      out.push(`  depfile = ${spec.depfile}`);
    }
    if (spec.deps !== undefined) {
      out.push(`  deps = ${spec.deps}`);
    }
    if (spec.restat === true) {
      out.push(`  restat = 1`);
    }
    if (spec.generator === true) {
      out.push(`  generator = 1`);
    }
    if (spec.pool !== undefined) {
      out.push(`  pool = ${spec.pool}`);
    }
    if (spec.rspfile !== undefined) {
      out.push(`  rspfile = ${spec.rspfile}`);
    }
    if (spec.rspfile_content !== undefined) {
      out.push(`  rspfile_content = ${spec.rspfile_content}`);
    }
    out.push("");
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

    const outs = node.outputs.map(p => ninjaEscapePath(this.rel(p)));
    const implOuts = (node.implicitOutputs ?? []).map(p => ninjaEscapePath(this.rel(p)));
    const ins = node.inputs.map(p => ninjaEscapePath(this.rel(p)));
    const implIns = (node.implicitInputs ?? []).map(p => ninjaEscapePath(this.rel(p)));
    const orderIns = (node.orderOnlyInputs ?? []).map(p => ninjaEscapePath(this.rel(p)));

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
    const stmt: string[] = [wrapLongLine(line)];

    if (node.pool !== undefined) {
      stmt.push(`  pool = ${node.pool}`);
    }
    if (node.vars !== undefined) {
      for (const [k, v] of Object.entries(node.vars)) {
        stmt.push(`  ${k} = ${ninjaEscapeVarValue(v)}`);
      }
    }
    stmt.push("");

    if (node.priority !== undefined) {
      this.prioritized.push({ priority: node.priority, text: stmt.join("\n") });
    } else {
      this.lines.push(...stmt);
    }
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

    // Stable sort: equal priorities keep emission order, which the emitters
    // use to put the largest inputs of a tier first.
    const prioritizedLines: string[] =
      this.prioritized.length > 0
        ? [
            `# ─── Scheduling order ───`,
            `# Ninja starts ready edges in file order; the long edges come first. See BuildNode.priority.`,
            ``,
            ...this.prioritized
              .slice()
              .sort((a, b) => b.priority - a.priority)
              .map(p => p.text),
          ]
        : [];

    return [...header, ...poolLines, ...this.declarations, ...prioritizedLines, ...this.lines, ...defaultLines].join(
      "\n",
    );
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
