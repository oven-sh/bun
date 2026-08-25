/**
 * Declares everything the emitters recorded on a `Ninja` instance as engine
 * tasks, so `--runner=ts` can run the whole build while modules are still
 * being ported to `Ninja.task()`.
 *
 * Native tasks map one to one. Rule-template edges (`Ninja.build()`) are
 * expanded here the way ninja expands them (`$in`, `$out`, `$var`, rule-level
 * `depfile`/`rspfile`), and run as a shell string. When the last `build()`
 * caller is gone, this file shrinks to `declareNative()` and the shell path
 * in engine.ts goes with it.
 */

import { resolve } from "node:path";
import { expandNinja } from "./depfile.ts";
import { type Command, type Engine, type Task } from "./engine.ts";
import type { GraphEdge, NativeTask, Ninja, Rule } from "./ninja.ts";
import { quoteWin32Argv } from "./shell.ts";

/** Declare every recorded edge and task. Returns the phony aliases by name (for `--target`). */
export function declareAll(engine: Engine, n: Ninja, hostWindows: boolean): void {
  const abs = (p: string) => resolve(n.buildDir, p);

  for (const t of n.tasks) declareNative(engine, t);

  // Phony edges with inputs are aliases. A phony with no inputs (`always`)
  // exists to make its dependents rerun every build; those dependents get
  // `alwaysRun` below and the phony itself is dropped.
  const always = new Set<string>();
  for (const e of n.edges) {
    if (e.rule !== "phony") continue;
    if (e.inputs.length === 0 && e.implicitInputs.length === 0) {
      for (const out of e.outputs) always.add(out);
    }
  }

  const expander = new EdgeExpander(n, hostWindows);
  for (const e of n.edges) {
    if (e.rule === "phony") {
      if (e.inputs.length + e.implicitInputs.length === 0) continue;
      for (const out of e.outputs) {
        engine.alias(out, [...e.inputs, ...e.implicitInputs, ...e.orderOnlyInputs].map(abs));
      }
      continue;
    }
    const rule = n.getRule(e.rule)!;
    // The generator rule re-runs configure when ninja is driven directly. The
    // engine only ever runs right after configure: nothing to do.
    if (rule.generator === true) continue;

    const after = e.orderOnlyInputs.filter(p => !always.has(p)).map(abs);
    const alwaysRun = e.orderOnlyInputs.some(p => always.has(p));
    const command: Command = { shell: expander.command(e, rule) };
    const rspfile = rule.rspfile !== undefined ? expander.binding(e, rule, "rspfile") : undefined;
    const depfile: NativeTask["depfile"] =
      rule.deps === "msvc"
        ? { kind: "msvc" }
        : rule.depfile !== undefined
          ? { kind: "gcc", path: abs(expander.binding(e, rule, "depfile")) }
          : undefined;
    // Labels come from the rule's description ("cxx obj/foo.o", "fetch zstd");
    // the leading word usually repeats the rule name, so drop it.
    let label = rule.description !== undefined ? expander.binding(e, rule, "description") : e.outputs[0]!;
    if (label.startsWith(e.rule + " ")) label = label.slice(e.rule.length + 1);
    engine.task({
      kind: e.rule,
      label,
      outputs: [...e.outputs, ...e.implicitOutputs].map(abs),
      inputs: [...e.inputs, ...e.implicitInputs].map(abs),
      after,
      command,
      rspfile:
        rspfile !== undefined
          ? { path: abs(rspfile), content: expander.binding(e, rule, "rspfile_content") }
          : undefined,
      depfile,
      restat: rule.restat === true,
      alwaysRun,
      pool: e.pool === "console" || e.pool === "" ? undefined : e.pool,
      console: e.pool === "console",
    });
  }
}

function declareNative(engine: Engine, t: NativeTask): Task {
  return engine.task({
    kind: t.kind,
    label: t.label,
    outputs: [...t.outputs, ...(t.implicitOutputs ?? [])],
    inputs: [...t.inputs, ...(t.implicitInputs ?? [])],
    after: t.after,
    command: t.commands.map(c => ({ argv: c.argv, cwd: c.cwd, env: c.env })),
    rspfile:
      t.rspfile !== undefined ? { path: t.rspfile, content: t.inputs.map(p => engine.rel(p)).join("\n") } : undefined,
    depfile: t.depfile,
    restat: t.restat,
    alwaysRun: t.alwaysRun,
    pool: t.pool,
    console: t.console,
  });
}

/** ninja's EdgeEnv: `$in`/`$out`/edge vars/rule bindings, with shell escaping of paths. */
class EdgeExpander {
  private readonly n: Ninja;
  private readonly windows: boolean;

  constructor(n: Ninja, windows: boolean) {
    this.n = n;
    this.windows = windows;
  }

  command(e: GraphEdge, rule: Rule): string {
    return this.binding(e, rule, "command");
  }

  /** depfile and rspfile are paths we open ourselves: no shell escaping, like ninja's GetUnescaped*. */
  binding(
    e: GraphEdge,
    rule: Rule,
    name: "command" | "description" | "depfile" | "rspfile" | "rspfile_content",
  ): string {
    const raw = rule[name];
    if (raw === undefined) return "";
    return this.expand(e, rule, raw, name !== "depfile" && name !== "rspfile");
  }

  private expand(e: GraphEdge, rule: Rule, template: string, escape: boolean): string {
    return expandNinja(template, name => this.lookup(e, rule, name, escape));
  }

  private lookup(e: GraphEdge, rule: Rule, name: string, escape: boolean): string | undefined {
    if (name === "in") return this.paths(e.inputs, " ", escape);
    if (name === "in_newline") return this.paths(e.inputs, "\n", escape);
    if (name === "out") return this.paths(e.outputs, " ", escape);
    const local = e.vars[name];
    if (local !== undefined) return local;
    const ruleVal = (rule as unknown as Record<string, unknown>)[name];
    if (typeof ruleVal === "string") return this.expand(e, rule, ruleVal, escape);
    return undefined;
  }

  private paths(paths: readonly string[], sep: string, escape: boolean): string {
    if (!escape) return paths.join(sep);
    return paths.map(p => (this.windows ? quoteWin32Argv(p) : shellEscape(p))).join(sep);
  }
}

/** POSIX: single-quote anything outside ninja's safe set. */
export function shellEscape(s: string): string {
  if (/^[A-Za-z0-9_+=:,./@%-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
