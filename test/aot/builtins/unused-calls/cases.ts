// Makes, from the table of built-ins, the programs of ../unused-calls.test.ts: every call, construction and read that the compiler may take
// away when nobody uses its result, with operands that are missing, of the wrong kind or extreme. Nothing is listed by name: a row or a
// mark that is written today is covered by the next run.
import type { CallMode, DumpedEntry, DumpedOverload, DumpedParameter, DumpedType, TableDump } from "../differential/table-description";

// The effects let a call of such an overload go with its unused result, if its operands allow it.
const mayBeRemoved = (overload: DumpedOverload) =>
  !overload.isUndeclared && (!overload.throws || overload.onlyPropagatesErrors) && (overload.capability !== "js" || overload.runsOnlyOperandCode);

export type LeftOut = { path: string; mode: CallMode; rule: string };

// With operands that nobody chose with care such an entry changes the machine, runs a text or starts something.
function findRuleAgainst(entry: DumpedEntry, overloads: readonly DumpedOverload[]): string | null {
  const flag = entry.flags.find(flag => ["StartsInstance", "LoadsModuleByName", "EvaluatesText", "RunsUnseenCode", "IsCompilerHelper"].includes(flag));
  if (flag !== undefined) return `the entry has the flag ${flag}`;
  // What the engine has outside the program is the clock and the queue of jobs.
  if (entry.origin !== "Host") return null;
  if (overloads.some(overload => overload.writes.includes("ExternalState"))) return "an overload of the host writes ExternalState";
  if (overloads.some(overload => overload.isUndeclared)) return "an overload of the host is not declared";
  if (overloads.some(overload => overload.capability === "js" && !overload.runsOnlyOperandCode)) return "an overload runs code that no operand names";
  return null;
}

const identifier = /^[A-Za-z_$][\w$]*$/;

export type Callee = { expression: string; module: string | null };

// "Object.keys", "Map.prototype[Symbol.iterator]", "node:util/types.isMap". A path under %..% or native: has no spelling in a program.
export function calleeOf(path: string): Callee | null {
  const [root, ...members] = path.match(/\[Symbol\.\w+\]|[^.[\]]+/g)!;
  if (path.includes("%") || root.startsWith("native:")) return null;
  const rest = members.map(member => (member.startsWith("[") ? member : identifier.test(member) ? `.${member}` : `[${JSON.stringify(member)}]`));
  const isGlobal = identifier.test(root);
  // What `require` answers for a module is the default export of its namespace.
  const start = isGlobal ? root : members.length === 0 ? "MODULE.default" : "MODULE";
  return { expression: `${start}${rest.join("")}`, module: isGlobal ? null : root };
}

// Over two lines, as plain Bun prints every function: the text of a function is an operand like any other.
const thrower = (member: string) => `{ ${member} {\n  throw new EvalError(${JSON.stringify(member)});\n} }`;

// Written out at every use: the compiler sees what the operand is.
export const oddOperands: readonly string[] = [
  "undefined",
  "null",
  "-1",
  "2 ** 31",
  "2 ** 53",
  "NaN",
  "Infinity",
  '""',
  '"x".repeat(70000)',
  'Symbol("s")',
  "1n",
  "{}",
  "[]",
  "function () {}",
  thrower("valueOf()"),
  thrower("toString()"),
  thrower("[Symbol.toPrimitive]()"),
  "{ get length() { throw new EvalError('length'); }, get a() { throw new EvalError('a'); }, get 0() { throw new EvalError('0'); }, get cause() { throw new EvalError('cause'); }, get then() { throw new EvalError('then'); }, get size() { throw new EvalError('size'); } }",
  "revoked()",
];

const otherReceivers: readonly string[] = ["undefined", "null", "{}", "1", '"a"', "true", "[]", "new Map()", "/a/", "function () {}", "revoked()"];

export class CaseMaker {
  readonly #entries: ReadonlyMap<string, DumpedEntry>;
  readonly #classes: TableDump["classes"];

  constructor(dump: TableDump) {
    this.#entries = new Map(dump.entries.map(entry => [entry.token, entry]));
    this.#classes = dump.classes;
  }

  #instanceOf(className: string): string {
    if (className === "Array") return "[1, 2]";
    const constructor = this.#classes.find(({ token }) => token === className)?.constructor;
    const path = constructor == null ? undefined : this.#entries.get(constructor)?.path;
    return path === undefined || calleeOf(path)?.module !== null ? "{}" : `new ${path}()`;
  }

  // An operand that the type takes.
  #operandOf(type: DumpedType): string {
    if (type.integers !== null) return String(Math.min(Math.max(1, type.integers.minimum), type.integers.maximum));
    if (type.stringLiterals.length > 0) return JSON.stringify(type.stringLiterals[0]);
    for (const part of type.parts) {
      if (part.part !== "Instance") continue;
      return part.class === "Array" && part.contents.length > 0 ? `[${this.#operandOf(part.contents[0].type)}]` : this.#instanceOf(part.class);
    }
    if (type.hasAnyObject || type.hasPlainData) return "{ a: 1 }";
    if (type.hasAnyFunction) return "function () {}";
    if (type.isAnything || type.primitives.includes("Number")) return "1";
    if (type.primitives.includes("String")) return '"a"';
    if (type.primitives.includes("Boolean")) return "true";
    if (type.primitives.includes("Symbol")) return 'Symbol("s")';
    if (type.primitives.includes("BigInt")) return "1n";
    return type.primitives.includes("Null") && !type.primitives.includes("Undefined") ? "null" : "undefined";
  }

  #receiverOf(entry: DumpedEntry, overload: DumpedOverload): string | null {
    if (overload.receiver !== null && !overload.receiver.accepted.isAnything) return this.#operandOf(overload.receiver.accepted);
    const ofClass = this.#classes.find(({ prototype }) => prototype !== null && prototype === entry.holder);
    if (ofClass !== undefined) return this.#instanceOf(ofClass.token);
    return overload.receiver === null ? null : "{ a: 1 }";
  }

  #argumentListsOf(overload: DumpedOverload): string[][] {
    const takes = ({ admitted, accepted }: DumpedParameter) => this.#operandOf(admitted ?? accepted);
    const whole = overload.parameters.map(takes);
    const lists = [whole, []];
    for (let length = whole.length - 1; length > 0; length--) lists.push(whole.slice(0, length));
    whole.forEach((_, index) => {
      for (const odd of oddOperands) lists.push(whole.with(index, odd));
    });
    if (whole.length === 0) for (const odd of oddOperands) lists.push([odd]);
    return lists;
  }

  // The expressions for one entry and one way to use it, each once.
  #expressionsOf(entry: DumpedEntry, mode: CallMode, callee: string, overloads: readonly DumpedOverload[]): string[] {
    const expressions = new Set<string>();
    const member = callee.slice(callee.endsWith("]") ? callee.lastIndexOf("[") : callee.lastIndexOf("."));
    for (const overload of overloads.filter(mayBeRemoved)) {
      // A global variable has no receiver that a program writes.
      const hasReceiver = (entry.kind === "Method" || entry.kind === "Accessor") && /[.\]]/.test(callee);
      const receiver = hasReceiver ? this.#receiverOf(entry, overload) : null;
      if (mode === "Get") {
        expressions.add(callee);
        if (receiver !== null) for (const object of [receiver, ...otherReceivers]) expressions.add(`(${object})${member}`);
        continue;
      }
      for (const list of this.#argumentListsOf(overload)) {
        const operands = list.join(", ");
        expressions.add(mode === "Construct" ? `new ${callee}(${operands})` : `${callee}(${operands})`);
        if (receiver === null) continue;
        expressions.add(`(${receiver})${member}(${operands})`);
        expressions.add(`${callee}.call(${[receiver, ...list].join(", ")})`);
      }
      const whole = this.#argumentListsOf(overload)[0];
      // Called where it is constructed, and constructed where it is called.
      expressions.add(mode === "Construct" ? `${callee}(${whole.join(", ")})` : `new ${callee}(${whole.join(", ")})`);
      if (receiver === null) continue;
      for (const other of otherReceivers) {
        expressions.add(`${callee}.call(${[other, ...whole].join(", ")})`);
        expressions.add(`(${other})${member}(${whole.join(", ")})`);
      }
    }
    return [...expressions];
  }

  make(dump: TableDump): { groups: Map<string, { module: string | null; expressions: string[] }>; leftOut: LeftOut[]; overloads: number } {
    const groups = new Map<string, { module: string | null; expressions: string[] }>();
    const leftOut: LeftOut[] = [];
    let overloads = 0;
    for (const entry of dump.entries) {
      if (entry.sameObjectAs !== null) continue;
      const isRead = entry.kind === "Accessor" || entry.kind === "DataProperty" || entry.kind === "Constant";
      const modes: CallMode[] = isRead ? ["Get"] : ["Call", "Construct"];
      for (const mode of modes) {
        const ofMode = entry.overloads.filter(overload => overload.mode === mode);
        const removable = ofMode.filter(mayBeRemoved).length;
        if (removable === 0) continue;
        const callee = calleeOf(entry.path);
        const rule = callee === null ? "no program can spell the path" : findRuleAgainst(entry, ofMode);
        if (callee === null || rule !== null) {
          leftOut.push({ path: entry.path, mode, rule: rule! });
          continue;
        }
        overloads += removable;
        const holder = callee.module ?? entry.path.split(/[.[]/, 1)[0];
        let group = groups.get(holder);
        if (group === undefined) groups.set(holder, (group = { module: callee.module, expressions: [] }));
        group.expressions.push(...this.#expressionsOf(entry, mode, callee.expression, ofMode));
      }
    }
    // A program costs a build, so the global holders with little to ask share theirs.
    const shared: string[] = [];
    for (const [holder, { module, expressions }] of groups) {
      if (module !== null || expressions.length >= 100) continue;
      shared.push(...expressions);
      groups.delete(holder);
    }
    if (shared.length > 0) groups.set("small global holders", { module: null, expressions: shared });
    return { groups, leftOut, overloads };
  }
}

const prelude = `const lines = [];
process.on("unhandledRejection", () => {});
globalThis.revoked = function () {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  return proxy;
};
function describe(error) {
  if ((typeof error !== "object" && typeof error !== "function") || error === null) return "threw " + String(error);
  return "threw " + error.name + ": " + error.message + (error.code === undefined ? "" : " [" + String(error.code) + "]");
}
function outcome(run) {
  try {
    run();
    return "returned";
  } catch (error) {
    return describe(error);
  }
}
let declared;
function check(expression, unused, used) {
  lines.push(JSON.stringify({ expression, declared, unused: outcome(unused), used: outcome(used) }));
}
`;

export function programOf(module: string | null, expressions: readonly string[]): string {
  // A declaration in the top-level code that nothing reads, a statement in a function, and a value that is kept.
  const checks = expressions.map(
    expression =>
      `try {\n  const unread = ${expression};\n  declared = "returned";\n} catch (error) {\n  declared = describe(error);\n}\n` +
      `check(${JSON.stringify(expression)}, () => {\n  ${expression};\n}, () => {\n  globalThis.kept = ${expression};\n});\n`,
  );
  const header = module === null ? "" : `import * as MODULE from ${JSON.stringify(module)};\n`;
  return `${header}${prelude}${checks.join("")}console.log(lines.join("\\n"));\n`;
}

// Whole statements of the top-level code are left out where nothing uses what they declare, so each expression is also the one statement of
// a module of its own: in a declaration that nothing reads and bare. The program loads the modules one after the other and says how that ended.
export function modulesOf(module: string | null, expressions: readonly string[]): Record<string, string> {
  const header = module === null ? "" : `import * as MODULE from ${JSON.stringify(module)};\n`;
  const files: Record<string, string> = {};
  const loads = expressions.map((expression, index) => {
    files[`declared-${index}.js`] = `${header}const unread = ${expression};\n`;
    files[`bare-${index}.js`] = `${header}${expression};\n`;
    const outcomeOf = (file: string) => `await import("./${file}-${index}.js").then(() => "returned", describe)`;
    return `lines.push(JSON.stringify({ expression: ${JSON.stringify(expression)}, declared: ${outcomeOf("declared")}, unused: ${outcomeOf("bare")}, used: "" }));\n`;
  });
  files["main.js"] = `${prelude}${loads.join("")}console.log(lines.join("\\n"));\n`;
  return files;
}
