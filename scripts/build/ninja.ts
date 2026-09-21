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
 * Every rule of the build, by the module that registers it, with the `$variables` its text uses (command,
 * description, depfile, rspfile). A build statement names one of these rules (or `phony`) and binds exactly its
 * variables, so a misspelled rule or a missing variable is a type error on every host, not an empty string in a
 * command on the one platform that emits the edge. A rule's variables are the same in every configuration: text
 * that needs other variables is another rule (`pch` / `pch_msvc`, `strip` / `copy_exe`).
 *
 * The table cannot drift from the rules: `Ninja.rule()` checks a rule's text against its entry.
 *
 * These are the build's own names. The names ninja itself gives a meaning (`reservedBindings`) are not variables:
 * they are the fields of `Rule`, and of a build statement where a value per edge makes sense.
 */
const ruleVars = {
  // bun.ts
  binary_verify: ["spec"],
  bk_upload: ["paths"],
  bk_upload_gz: ["paths"],
  copy_exe: [],
  dsymutil: [],
  duplicate_symbols: [],
  rc: ["rcflags"],
  shim_verify: ["spec"],
  smoke_test: [],
  strip: ["stripflags"],
  // codegen.ts
  bun_install: ["dir", "stamp"],
  codegen: ["cwd", "args", "desc"],
  codegen_bun: ["cwd", "args", "desc"],
  esbuild: ["cwd", "args", "desc"],
  npm_install: ["dir", "stamp"],
  // compile.ts
  ar: [],
  cc: ["cflags"],
  cxx: ["cxxflags"],
  cxx_pch: ["cxxflags", "pch_file", "pch_header"],
  link: ["ldflags"],
  mkdir_stamp: ["dir"],
  nasm: ["nasmflags"],
  pch: ["cxxflags", "pch_header"],
  pch_msvc: ["cxxflags", "pch_header", "pch_stub_obj"],
  // configure.ts
  regen: [],
  // rust/emit.ts
  rust_build_script: ["manifest", "crate"],
  rust_plan: ["planinput", "plan"],
  rust_rustc: ["manifest", "crate", "what"],
  // shims.ts
  host_tool_cc: [],
  shim_crt_decompress: [],
  // source.ts
  dep_build: ["name", "builddir", "buildtype", "targets"],
  dep_cargo: ["name", "manifestdir", "env", "args"],
  dep_cargo_cross: ["name", "manifestdir", "env", "args", "rust_target"],
  dep_check_undefined: ["name", "nm", "symbols"],
  dep_codegen: ["name", "cwd", "tool", "args"],
  dep_configure: ["name", "srcdir", "builddir", "args"],
  dep_fetch: ["name", "repo", "commit", "dest", "cache", "patches"],
  dep_fetch_prebuilt: ["name", "url", "dest", "identity", "rm_paths"],
  dep_host_cc: ["flags"],
  dep_prebuild: ["name", "cwd", "cmd"],
  dep_subst: ["pairs"],
} as const satisfies Record<string, readonly string[]>;

/** ninja's `Rule::IsReservedBinding` (src/eval_env.cc; `early_output_prefix` is oven-sh/ninja's). */
const reservedBindings = [
  "command",
  "depfile",
  "dyndep",
  "description",
  "deps",
  "generator",
  "pool",
  "restat",
  "rspfile",
  "rspfile_content",
  "msvc_deps_prefix",
  "early_output_prefix",
];

export type RuleName = keyof typeof ruleVars;
/** The `vars` of a build statement of rule `R`. */
type RuleVars<R extends RuleName> = { [K in (typeof ruleVars)[R][number]]: string };

/** Every job pool: ninja's built-in `console`, and the ones the build declares. */
export type PoolName = "bk_upload" | "bun_install" | "compile" | "console" | "dep";

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
  pool?: PoolName;
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
interface BuildNodeBase {
  /** Files this build produces. Must not be empty. */
  outputs: string[];
  /** Additional outputs that ninja tracks but that don't appear in $out. */
  implicitOutputs?: string[];
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
  /**
   * Validations (ninja `|@ target` syntax, 1.11+). Built whenever this edge
   * is, without being inputs of it or of anything downstream. Use for:
   * checks on an output (smoke test, symbol audits) that should run with
   * every build of it but block nothing.
   */
  validations?: string[];
  /** Job pool override (overrides rule's pool). */
  pool?: PoolName;
  /** This edge's depfile, for a rule whose depfile is not a function of `$out` (the rule sets `deps`). */
  depfile?: string;
  /**
   * oven-sh/ninja's `early_output_prefix` binding: the command may announce an output as complete before it exits
   * by printing this prefix and the output's name (rust/emit.ts). A ninja without the feature ignores it.
   */
  earlyOutputPrefix?: string;
}

/** `vars`: required when the rule has variables, absent when it has none. */
type VarsField<R extends RuleName> = [keyof RuleVars<R>] extends [never] ? { vars?: never } : { vars: RuleVars<R> };

/** A build statement of rule `R` (or a `phony`): the rule, and that rule's variables. */
export type BuildNode<R extends RuleName | "phony" = RuleName | "phony"> = R extends RuleName
  ? BuildNodeBase & { rule: R } & VarsField<R>
  : BuildNodeBase & { rule: "phony"; vars?: never };

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
 * A `$` in a rule's text, read the way ninja's lexer reads it (src/lexer.in.cc): `$$` is a literal dollar, `$name` is
 * `[a-zA-Z0-9_-]+`, so `$out-tmp` is the variable `out-tmp`, and `${name}` may also contain `.`.
 */
const reference = /\$(?:(\$)|\{([a-zA-Z0-9_.-]+)\}|([a-zA-Z0-9_-]+))/g;

/** The variables in a rule's text, other than ninja's own (`$in`, `$out`, `$in_newline`). */
function variablesIn(...texts: (string | undefined)[]): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    for (const [, dollar, braced, bare] of (text ?? "").matchAll(reference)) {
      const name = braced ?? bare;
      if (dollar === undefined && name !== "in" && name !== "out" && name !== "in_newline") found.add(name!);
    }
  }
  return [...found];
}

/** A rule's text with each variable replaced by `value(name)`, as ninja expands it. */
export function expand(text: string, value: (name: string) => string): string {
  return text.replace(reference, (_, dollar?: string, braced?: string, bare?: string) =>
    dollar !== undefined ? "$" : value((braced ?? bare)!),
  );
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
  private readonly ruleNames = new Set<RuleName>();
  private readonly generatorRules = new Set<RuleName>();
  private readonly outputSet = new Set<string>();
  private readonly pools = new Map<string, number>();
  private readonly defaults: string[] = [];
  private readonly compileCommands: CompileCommand[] = [];

  constructor(opts: NinjaOptions) {
    assert(isAbsolute(opts.buildDir), `Ninja buildDir must be absolute, got: ${opts.buildDir}`);
    this.buildDir = resolve(opts.buildDir);
    // 1.11: validations (`|@`). Below that: implicit outputs (1.7),
    // console pool (1.5), restat (1.0). No dyndep.
    this.ninjaVersion = opts.ninjaVersion ?? "1.11";
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
    this.lines.push(`${name} = ${ninjaEscapeVarValue(name, value)}`);
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
  pool(name: Exclude<PoolName, "console">, depth: number): void {
    assert(!this.pools.has(name), `Duplicate pool: ${name}`);
    assert(depth >= 1, `Pool depth must be >= 1, got: ${depth}`);
    this.pools.set(name, depth);
  }

  /** Define a ninja rule. */
  rule(name: RuleName, spec: Rule): void {
    assert(!this.ruleNames.has(name), `Duplicate rule: ${name}`);
    this.ruleNames.add(name);

    const declared: readonly string[] = ruleVars[name];
    const used = variablesIn(spec.command, spec.description, spec.depfile, spec.rspfile, spec.rspfile_content);
    for (const v of used) {
      assert(!reservedBindings.includes(v), `Rule ${name} reads $${v}, a binding ninja reserves`, {
        hint: "A reserved binding is a field of the rule or of the build statement, not a variable.",
      });
      assert(declared.includes(v), `Rule ${name} uses $${v}, which ruleVars does not list`, {
        hint: `Add "${v}" to ruleVars.${name} in ninja.ts. If only some configurations' text uses it, that text is another rule.`,
      });
    }
    for (const v of declared) {
      assert(used.includes(v), `ruleVars lists "${v}" for rule ${name}, whose text does not use it`, {
        hint: `Remove it from ruleVars.${name}. If another configuration's text uses it, that text is another rule.`,
      });
    }

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
      this.generatorRules.add(name);
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
  build<R extends RuleName | "phony">(node: { rule: R } & BuildNode<R>): void {
    assert(node.outputs.length > 0, `Build node must have at least one output (rule: ${node.rule})`);
    assert(node.rule === "phony" || this.ruleNames.has(node.rule), `Unknown rule: ${node.rule}`, {
      hint: `Define the rule with ninja.rule("${node.rule}", {...}) first`,
    });
    const vars: Record<string, string> = node.vars ?? {};
    // A missing variable is always a type error. An undeclared one is only in a literal: an object built elsewhere
    // and passed in may carry more keys than its type says.
    const rule: RuleName | "phony" = node.rule;
    if (rule !== "phony") {
      const declared: readonly string[] = ruleVars[rule];
      for (const v of Object.keys(vars)) {
        assert(
          declared.includes(v),
          `A ${node.rule} edge (${node.outputs[0]}) binds ${v}, which ruleVars does not list for that rule`,
        );
      }
    }

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
    // Ninja matches paths textually: `codegen/X.h` (how edges name files under
    // buildDir) and `/abs/build/codegen/X.h` (how a compiler's depfile names
    // the same file, found through an absolute -I) are two nodes, and only
    // the first would have this edge as its producer — so a TU whose depfile
    // names a generated header would not be recompiled in the build that
    // regenerates it, only in the next one. Declaring the absolute spelling
    // as an implicit output of the same edge makes both names resolve here
    // (CMake's Ninja generator does the same for custom-command outputs).
    // Not for phonies (no file) or the generator edge (build.ninja: ninja
    // knows its manifest by the relative name only).
    if (node.rule !== "phony" && !this.generatorRules.has(node.rule)) {
      for (const p of allOuts) {
        if (isAbsolute(p) && this.rel(p) !== resolve(p)) implOuts.push(ninjaEscapePath(resolve(p)));
      }
    }
    const ins = node.inputs.map(p => ninjaEscapePath(this.rel(p)));
    const implIns = (node.implicitInputs ?? []).map(p => ninjaEscapePath(this.rel(p)));
    const orderIns = (node.orderOnlyInputs ?? []).map(p => ninjaEscapePath(this.rel(p)));
    const validations = (node.validations ?? []).map(p => ninjaEscapePath(this.rel(p)));

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
    if (validations.length > 0) {
      line += ` |@ ${validations.join(" ")}`;
    }

    // Wrap long lines with $\n continuations for readability
    this.lines.push(wrapLongLine(line));

    if (node.pool !== undefined) {
      this.lines.push(`  pool = ${node.pool}`);
    }
    for (const [k, v] of Object.entries(vars)) {
      this.lines.push(`  ${k} = ${ninjaEscapeVarValue(k, v)}`);
    }
    if (node.depfile !== undefined) {
      this.lines.push(`  depfile = ${ninjaEscapeVarValue("depfile", node.depfile)}`);
    }
    if (node.earlyOutputPrefix !== undefined) {
      this.lines.push(`  early_output_prefix = ${ninjaEscapeVarValue("early_output_prefix", node.earlyOutputPrefix)}`);
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

    return [...header, ...poolLines, ...this.lines, ...defaultLines].join("\n");
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

    // Only write files whose content actually changed, so the return value
    // (and compile_commands.json's mtime, which editors watch) means
    // something. build.ninja's own mtime is configure.ts's business: it
    // stamps it after every configure for the regen edge's sake.
    const changed = writeIfChanged(resolve(this.buildDir, "build.ninja"), this.toString());

    writeIfChanged(
      resolve(this.buildDir, "compile_commands.json"),
      JSON.stringify(this.compileCommands, null, 2) + "\n",
    );

    return changed;
  }
}

// ---------------------------------------------------------------------------
// Reading build.ninja back
//
// The inverse of `Ninja.toString()`, for tools that describe a build directory after the fact (timings.ts). It reads
// what this file writes, not the whole ninja language: no `include`/`subninja`, no variable references in paths.
// ---------------------------------------------------------------------------

export interface ManifestRule {
  /** Unexpanded: `$out`, `$in` and the edge's variables are still references. */
  description: string | undefined;
  restat: boolean;
  generator: boolean;
  pool: string | undefined;
}

export interface ManifestEdge {
  /** A rule's name, or `phony`. */
  rule: string;
  outputs: string[];
  /** Includes the absolute spelling `Ninja.build()` declares for each output. */
  implicitOutputs: string[];
  inputs: string[];
  implicitInputs: string[];
  orderOnlyInputs: string[];
  validations: string[];
  /** The indented `name = value` lines: the rule's variables, `pool`, `depfile`, `early_output_prefix`. */
  bindings: Record<string, string>;
}

export interface Manifest {
  /** Declared pools and their depth (`console` is ninja's own and is not declared). */
  pools: Map<string, number>;
  rules: Map<string, ManifestRule>;
  edges: ManifestEdge[];
}

/** Parse the text of a `build.ninja` written by `Ninja`. Paths stay as written: relative to the build directory. */
export function readManifest(text: string): Manifest {
  const manifest: Manifest = { pools: new Map(), rules: new Map(), edges: [] };
  // `$` + newline continues a statement; ninja drops the newline and the next line's indentation. A `$$` is read
  // first, so a value that ends in a literal dollar does not continue.
  const lines = text.replace(/\$\$|\$\r?\n[ \t]*/g, m => (m === "$$" ? m : "")).split(/\r?\n/);
  let bind: (name: string, value: string) => void = () => {};
  for (const line of lines) {
    if (line.startsWith("#") || line.trim() === "") continue;
    const binding = /^\s+([a-zA-Z0-9_.-]+) = (.*)$/.exec(line);
    if (binding !== null) {
      bind(binding[1]!, binding[2]!);
      continue;
    }
    bind = () => {};
    const [keyword, rest = ""] = splitOnce(line, " ");
    if (keyword === "rule") {
      const rule: ManifestRule = {
        description: undefined,
        restat: false,
        generator: false,
        pool: undefined,
      };
      manifest.rules.set(rest, rule);
      bind = (name, value) => {
        if (name === "description") rule.description = value;
        else if (name === "restat") rule.restat = true;
        else if (name === "generator") rule.generator = true;
        else if (name === "pool") rule.pool = value;
      };
    } else if (keyword === "pool") {
      bind = (name, value) => {
        if (name === "depth") manifest.pools.set(rest, Number(value));
      };
    } else if (keyword === "build") {
      const edge = readBuildLine(rest);
      manifest.edges.push(edge);
      bind = (name, value) => {
        edge.bindings[name] = value.replaceAll("$$", "$");
      };
    }
    // `default`, `ninja_required_version = …` and other top-level variables say nothing about the graph.
  }
  return manifest;
}

function splitOnce(s: string, sep: string): [string, string | undefined] {
  const at = s.indexOf(sep);
  return at < 0 ? [s, undefined] : [s.slice(0, at), s.slice(at + sep.length)];
}

/** `outs [| implicit outs]: rule [ins] [| implicit ins] [|| order-only ins] [|@ validations]`, undoing `ninjaEscapePath`. */
function readBuildLine(text: string): ManifestEdge {
  const edge: ManifestEdge = {
    rule: "",
    outputs: [],
    implicitOutputs: [],
    inputs: [],
    implicitInputs: [],
    orderOnlyInputs: [],
    validations: [],
    bindings: {},
  };
  let into = edge.outputs;
  let afterColon = false;
  let word = "";
  const endWord = () => {
    if (word === "") return;
    if (word === "|") into = afterColon ? edge.implicitInputs : edge.implicitOutputs;
    else if (word === "||") into = edge.orderOnlyInputs;
    else if (word === "|@") into = edge.validations;
    else if (afterColon && edge.rule === "") edge.rule = word;
    else into.push(word);
    word = "";
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "$") {
      const escaped = text[++i];
      assert(
        escaped === "$" || escaped === " " || escaped === ":",
        `build.ninja: a path refers to a variable: ${text}`,
        {
          hint: "Ninja.build() escapes every `$` in a path, so this file was not written by it.",
        },
      );
      word += escaped;
    } else if (c === " ") endWord();
    else if (c === ":" && !afterColon) {
      endWord();
      afterColon = true;
      into = edge.inputs;
    } else word += c;
  }
  endWord();
  assert(edge.rule !== "" && edge.outputs.length > 0, `build.ninja: not a build statement: build ${text}`);
  return edge;
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
  assert(!path.includes("\n"), `Newline in ninja path: ${JSON.stringify(path)}`);
  return path.replace(/\$/g, "$$$$").replace(/ /g, "$ ").replace(/:/g, "$:");
}

/** Escape a value for use on the right side of `var = value`. */
function ninjaEscapeVarValue(name: string, value: string): string {
  // A newline ends the binding; ninja has no escape for one inside a value.
  assert(!value.includes("\n"), `Newline in ninja variable '${name}': ${JSON.stringify(value)}`);
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
