// Every function in the table of built-ins is passed to native code that calls it (a promise reaction, an array method, Reflect.apply, an accessor, a timer ..) with an operand it
// rejects: a symbol, a BigInt, null, an object whose conversion throws. Each case inspects what it catches in a handler of its own. The functions follow from the table, so a new row is called too.
//
//   bun built-ins-called-by-native-code-with-operands-they-reject.ts <aot_builtin_table.json> <list.json>                    writes which function rejects which operand
//   bun built-ins-called-by-native-code-with-operands-they-reject.ts <aot_builtin_table.json> <folder> [regular expression]  writes the programs whose name matches
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { excluded } from "../fuzz/fuzzilli/excluded-builtins";

type Entry = { path: string; kind: string; origin: string; platforms: string[]; overloads: { mode: string }[] };
export type Rejecting = { holder: string; callee: string; origin: string; operands: string[] };

export const operands: Record<string, string> = {
  "a symbol": "Symbol.iterator",
  "a bigint": "1n",
  "null": "null",
  "an object whose conversion throws an error": '{ [Symbol.toPrimitive]() { throw new RangeError("converted"); } }',
  "an object whose conversion throws a number": "{ valueOf() { throw 7; }, toString() { throw 7; } }",
};

function expressionOf(path: string): string | null {
  if (path.includes("%")) return null;
  const module = /^((?:node|bun):[\w/]+)(.*)$/.exec(path);
  return module ? `require("${module[1]}")${module[2]}` : path;
}

const finishesOnAnotherThread = /^Bun\.password\b/;

const holderOf = (path: string) => /^(.+?)(\.[\w$]+|\[[^\]]*\])$/.exec(path)?.[1] ?? "globalThis";

/** It calls each function with each operand. */
export function listRejecting(entries: Entry[]): Rejecting[] {
  const rejecting: Rejecting[] = [];
  for (const entry of entries) {
    if (!["Function", "Method", "Constructor"].includes(entry.kind) || excluded.test(entry.path)) continue;
    if (finishesOnAnotherThread.test(entry.path)) continue;
    if (!entry.platforms.includes("Linux") || !entry.overloads.some(overload => overload.mode === "Call")) continue;
    const callee = expressionOf(entry.path);
    if (callee === null) continue;
    const evaluate = (text: string) => new Function("require", `return ${text};`)(require);
    let called: unknown;
    try {
      called = evaluate(callee);
    } catch {}
    if (typeof called !== "function") continue;
    const rejected = Object.entries(operands).filter(([, operand]) => {
      try {
        called.call(undefined, evaluate(`(${operand})`));
        return false;
      } catch {
        return true;
      }
    });
    if (rejected.length)
      rejecting.push({
        holder: holderOf(entry.path),
        callee,
        origin: entry.origin,
        operands: rejected.map(([name]) => name),
      });
  }
  return rejecting;
}

const inspect = (label: string) =>
  `console.log(${JSON.stringify(label)}, typeof caught, caught === undefined, caught instanceof TypeError, caught?.name, typeof caught?.message)`;

type Caller = (callee: string, operand: string) => string;

const settled = (promise: Caller) => (callee: string, operand: string, label: string) =>
  `${promise(callee, operand)}.then(() => console.log(${JSON.stringify(label)}, "fulfilled"), caught => ${inspect(label)}); await turn();`;
const returned = (call: Caller) => (callee: string, operand: string, label: string) =>
  `try { console.log(${JSON.stringify(label)}, "returned", typeof ${call(callee, operand)}); } catch (caught) { ${inspect(label)}; }`;
const reported = (event: string) => (start: Caller) => (callee: string, operand: string, label: string) =>
  `process.once("${event}", caught => ${inspect(label)}); ${start(callee, operand)}; await turn(); process.removeAllListeners("${event}");`;
const prologue = "const turn = () => new Promise(resolve => setTimeout(resolve, 2));\n";

type Write = (callee: string, operand: string, label: string) => string;
// With other operands a function of the host does whatever it is for: it is only called where the operand that it rejects comes first.
type Case = { passesOperand: boolean; write: Write };

const each = (callers: Record<string, Caller>, wrap: (caller: Caller) => Write): Record<string, Case> =>
  Object.fromEntries(
    Object.entries(callers).map(([name, caller]) => [
      name,
      { passesOperand: caller.length === 2, write: wrap(caller) },
    ]),
  );

export const callers: Record<string, Record<string, Case>> = {
  "promises": each(
    {
      "then": (f, v) => `Promise.resolve(${v}).then(${f})`,
      "then and catch": (f, v) => `Promise.resolve(${v}).then(${f}).catch(error => { throw error; })`,
      "then after another reaction": (f, v) => `Promise.resolve(${v}).then(value => value).then(${f})`,
      "then on the promise of an async function": (f, v) => `(async () => (${v}))().then(${f})`,
      "then and finally": (f, v) => `Promise.resolve(${v}).then(${f}).finally(() => {})`,
      "catch": (f, v) => `Promise.reject(${v}).catch(${f})`,
      "the second argument of then": (f, v) => `Promise.reject(${v}).then(undefined, ${f})`,
      "finally": (f, v) => `Promise.resolve(${v}).finally(${f})`,
      "Promise.try": (f, v) => `Promise.try(${f}, ${v})`,
      "the executor of a promise": f => `new Promise(${f})`,
      "Array.fromAsync": (f, v) => `Array.fromAsync([${v}], ${f}, 0)`,
      "then, bound": (f, v) => `Promise.resolve(${v}).then(${f}.bind(undefined))`,
      "then, bound to the operand": (f, v) => `Promise.resolve().then(${f}.bind(undefined, ${v}))`,
      "then, through call": (f, v) => `Promise.resolve(${v}).then(Function.prototype.call.bind(${f}, undefined))`,
      "then, through Reflect.apply": (f, v) =>
        `Promise.resolve([${v}]).then(Reflect.apply.bind(undefined, ${f}, undefined))`,
      "Promise.all": (f, v) => `Promise.all([Promise.resolve(${v}).then(${f})])`,
      "Promise.race": (f, v) => `Promise.race([Promise.resolve(${v}).then(${f})])`,
      "Promise.any": (f, v) =>
        `Promise.any([Promise.resolve(${v}).then(${f})]).catch(({ errors }) => { throw errors[0]; })`,
      "Promise.allSettled": (f, v) =>
        `Promise.allSettled([Promise.resolve(${v}).then(${f})]).then(([{ status, reason }]) => { if (status === "rejected") throw reason; })`,
      "an awaited promise": (f, v) => `(async () => { await Promise.resolve(${v}).then(${f}); })()`,
      "a returned promise": (f, v) => `(async () => Promise.resolve(${v}).then(${f}))()`,
    },
    settled,
  ),
  "calls": each(
    {
      "map": (f, v) => `[${v}].map(${f})`,
      "forEach": (f, v) => `[${v}].forEach(${f})`,
      "filter": (f, v) => `[${v}].filter(${f})`,
      "find": (f, v) => `[${v}].find(${f})`,
      "findLast": (f, v) => `[${v}].findLast(${f})`,
      "some": (f, v) => `[${v}].some(${f})`,
      "every": (f, v) => `[${v}].every(${f})`,
      "flatMap": (f, v) => `[${v}].flatMap(${f})`,
      "reduce": (f, v) => `[0].reduce(${f}, ${v})`,
      "sort": (f, v) => `[${v}, ${v}].sort(${f})`,
      "toSorted": (f, v) => `[${v}, ${v}].toSorted(${f})`,
      "Array.from": (f, v) => `Array.from([${v}], ${f})`,
      "Object.groupBy": (f, v) => `Object.groupBy([${v}], ${f})`,
      "forEach of a map": (f, v) => `new Map([[0, ${v}]]).forEach(${f})`,
      "forEach of a set": (f, v) => `new Set([${v}]).forEach(${f})`,
      "map of an iterator": (f, v) => `[${v}].values().map(${f}).next()`,
      "map of a typed array": f => `new BigInt64Array(1).map(${f})`,
      "Reflect.apply": (f, v) => `Reflect.apply(${f}, undefined, [${v}])`,
      "call": (f, v) => `${f}.call(undefined, ${v})`,
      "apply": (f, v) => `${f}.apply(undefined, [${v}])`,
      "bind": (f, v) => `${f}.bind(undefined, ${v})()`,
      "the reviver of JSON.parse": f => `JSON.parse("[1]", ${f})`,
      "the replacer of JSON.stringify": f => `JSON.stringify([1], ${f})`,
      "the replacer of replace": f => `"a".replace("a", ${f})`,
      "the replacer of replace with a pattern": f => `"a".replace(/a/, ${f})`,
      "the replacer of replaceAll": f => `"a".replaceAll("a", ${f})`,
      "a tagged template": f => `(tag => tag\`\`)(${f})`,
    },
    returned,
  ),
  "members": each(
    {
      "a getter": f => `Object.defineProperty({}, "member", { get: ${f} }).member`,
      "a setter": (f, v) => `(Object.defineProperty({}, "member", { set: ${f} }).member = ${v})`,
      "a setter through Reflect.set": (f, v) =>
        `Reflect.set(Object.defineProperty({}, "member", { set: ${f} }), "member", ${v})`,
      "a setter through Object.assign": (f, v) =>
        `Object.assign(Object.defineProperty({}, "member", { set: ${f} }), { member: ${v} })`,
      "valueOf": f => `+{ valueOf: ${f} }`,
      "toString": f => `\`\${{ toString: ${f} }}\``,
      "Symbol.toPrimitive": f => `+{ [Symbol.toPrimitive]: ${f} }`,
      "toJSON": f => `JSON.stringify({ toJSON: ${f} })`,
      "Symbol.iterator": f => `[...{ [Symbol.iterator]: ${f} }]`,
      "Symbol.hasInstance": (f, v) => `(${v} instanceof { [Symbol.hasInstance]: ${f} })`,
      "the get trap of a proxy": f => `new Proxy({}, { get: ${f} }).member`,
      "the has trap of a proxy": f => `("member" in new Proxy({}, { has: ${f} }))`,
      "the apply trap of a proxy": (f, v) => `new Proxy(() => {}, { apply: ${f} })(${v})`,
    },
    returned,
  ),
  "thenables and streams": each(
    {
      "then of a thenable": f => `Promise.resolve({ then: ${f} })`,
      "then of an awaited thenable": f => `(async () => { await { then: ${f} }; })()`,
      "write of a writable stream": (f, v) => `new WritableStream({ write: ${f} }).getWriter().write(${v})`,
      "pull of a readable stream": f => `new ReadableStream({ pull: ${f} }).getReader().read()`,
      "util.promisify": (f, v) => `require("node:util").promisify(${f})(${v})`,
    },
    settled,
  ),
  "jobs": each(
    {
      "setTimeout": (f, v) => `setTimeout(${f}.bind(undefined), 0, ${v})`,
      "setImmediate": (f, v) => `setImmediate(${f}.bind(undefined), ${v})`,
      "process.nextTick": (f, v) => `process.nextTick(${f}.bind(undefined), ${v})`,
      "queueMicrotask": (f, v) => `queueMicrotask(${f}.bind(undefined, ${v}))`,
    },
    reported("uncaughtException"),
  ),
  "rejections nobody handles": each(
    {
      "then": (f, v) => `Promise.resolve(${v}).then(${f})`,
      "Promise.try": (f, v) => `Promise.try(${f}, ${v})`,
    },
    reported("unhandledRejection"),
  ),
};

const calleesInOneProgram = 12;

function withImports(text: string): string {
  const modules: string[] = [];
  const body = text.replace(/require\("([^"]+)"\)/g, (_, name) => {
    if (!modules.includes(name)) modules.push(name);
    return `module${modules.indexOf(name)}`;
  });
  return modules.map((name, index) => `import module${index} from "${name}";\n`).join("") + prologue + body;
}

export type Program = { name: string; origin: string; text: string };

export function programsOf(rejecting: Rejecting[]): Program[] {
  const programs: Program[] = [];
  for (const [holder, ofHolder] of Map.groupBy(rejecting, each => each.holder))
    for (const [operandName, operand] of Object.entries(operands)) {
      const callees = ofHolder.filter(each => each.operands.includes(operandName));
      for (let first = 0; first < callees.length; first += calleesInOneProgram)
        for (const [group, ofGroup] of Object.entries(callers)) {
          const cases = callees.slice(first, first + calleesInOneProgram).flatMap(({ callee, origin }) =>
            Object.entries(ofGroup)
              .filter(([, { passesOperand }]) => passesOperand || origin === "Engine")
              .map(([name, { write }]) => write(callee, operand, `${callee} | ${name} |`)),
          );
          if (cases.length)
            programs.push({
              name: `${holder} ${first / calleesInOneProgram + 1}, ${operandName}, ${group}`,
              origin: callees[first].origin,
              text: withImports(cases.join("\n") + "\n"),
            });
        }
    }
  return programs;
}

if (import.meta.main) {
  const [tablePath, folder, filterText] = process.argv.slice(2);
  const rejecting = listRejecting(JSON.parse(readFileSync(tablePath, "utf8")).entries);
  if (folder.endsWith(".json")) writeFileSync(folder, JSON.stringify(rejecting));
  else {
    mkdirSync(folder, { recursive: true });
    const filter = new RegExp(filterText ?? ".");
    const programs = programsOf(rejecting).filter(program => filter.test(program.name));
    for (const program of programs)
      writeFileSync(join(folder, program.name.replace(/[^\w.]+/g, "-") + ".mjs"), program.text);
    console.log(`${rejecting.length} functions, ${programs.length} programs`);
  }
  process.exit(0);
}
