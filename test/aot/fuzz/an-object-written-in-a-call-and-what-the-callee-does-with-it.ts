// Small programs about one object or list that is written as an argument of a call, and one thing that the callee does with it beyond reading its members. It is an object like any other: it has an
// identity, keys in an order, a prototype; it can be stored to, kept, handed on, answered with. There is one scene, and every line is printed at once, by `console.log` itself.
//
//   the argument   a literal of two or three members, with a fraction, a text, an inner literal, a method, a getter, a spread, a computed key; a list; `new` of a small class; a literal in a default
//   the parameter  a name, a pattern, a pattern with defaults and a rest, `arguments`, a rest parameter, `this` by `call`
//   the callee     a declared function, an arrow, a method, a constructor, a generator, an async function; called once, in a loop, through `apply`, as a callback
//   what it does   answers with it, keeps it outside, compares it with itself and with the one of the last call, stores to it, adds and deletes members, lists its keys, freezes it, hands it to a
//                  built-in, to another function, throws it, yields it, captures it, reads a member that is not there, asks for its prototype, spreads it, writes it as JSON
//   then           what the callee answered; what was kept, behind another call and a collection
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string } {
  const argument = (n: string) =>
    random.weighted([
      [6, `{ a: ${n}, b: "t" }`],
      [2, `{ a: ${n} + 0.5, b: ${n} }`],
      [2, `{ a: ${n}, inner: { c: ${n} } }`],
      [1, `{\na: ${n},\nm() {\nreturn this.a;\n},\n}`],
      [1, `{\nget a() {\nreturn ${n};\n},\nb: "t",\n}`],
      [1, `{ ...{ a: ${n} }, b: "t" }`],
      [1, `{ ["a"]: ${n}, b: "t" }`],
      [2, `[${n}, "t"]`],
      [2, `new Pair(${n}, "t")`],
      [1, `{ b: "t", a: ${n} }`],
      [1, `{ a: ${n} }`],
    ]);
  const taken = random.weighted([
    [7, "name"],
    [2, "arguments"],
    [2, "rest"],
    [2, "this"],
    [2, "default"],
  ] as const);
  const O = { name: "o", arguments: "arguments[0]", rest: "all[0]", this: "this", default: "o" }[taken];
  const does = random.weighted<[string, boolean]>([
    [4, [`return ${O};`, true]],
    [4, [`kept.push(${O});\nreturn ${O}.a;`, false]],
    [2, [`const same = ${O} === last;\nlast = ${O};\nreturn same;`, false]],
    [2, [`return ${O} === ${O} && [${O}].includes(${O});`, false]],
    [3, [`${O}.a = 9;\nreturn ${O}.a;`, false]],
    [2, [`${O}.added = 1;\nreturn Object.keys(${O}).join();`, false]],
    [2, [`delete ${O}.a;\nreturn Object.keys(${O}).join() + " " + ${O}.a;`, false]],
    [3, [`return Object.keys(${O}).join();`, false]],
    [2, [`return JSON.stringify(${O});`, false]],
    [1, [`return Object.isFrozen(Object.freeze(${O})) + " " + ${O}.a;`, false]],
    [2, [`return Object.assign({}, ${O}).a;`, false]],
    [2, [`return JSON.stringify({ ...${O} });`, false]],
    [2, [`return other(${O});`, false]],
    [2, [`throw ${O};`, true]],
    [2, [`return () => ${O};`, true]],
    [2, [`return ${O}.missing;`, false]],
    [1, [`return Object.getPrototypeOf(${O}) === Object.prototype;`, false]],
    [1, [`return "a" in ${O} && Object.hasOwn(${O}, "a");`, false]],
    [1, [`let names = "";\nfor (const name in ${O}) names += name;\nreturn names;`, false]],
    [1, [`return Object.entries(${O}).length;`, false]],
    [1, [`map.set(${O}, 1);\nreturn map.size;`, false]],
    [1, [`return new Proxy(${O}, {}).a;`, false]],
    [1, [`return Reflect.ownKeys(${O}).length;`, false]],
    [1, [`Object.defineProperty(${O}, "a", { value: 7 });\nreturn ${O}.a;`, false]],
    [1, [`Object.setPrototypeOf(${O}, { above: "above" });\nreturn ${O}.above;`, false]],
    [1, [`return typeof ${O} + " " + String(${O}.a) + " " + String(${O}[0]);`, false]],
    [1, [`return structuredClone(${O}) === ${O};`, false]],
    [1, [`const { a, ...others } = ${O};\nreturn String(a) + JSON.stringify(others);`, false]],
  ]);
  const [work] = does;
  const parameters = { name: "o", arguments: "", rest: "...all", this: "", default: `o = ${argument("0")}` }[taken];
  const kind =
    taken === "arguments" || taken === "this"
      ? random.pick(["declared", "method"] as const)
      : random.pick(["declared", "declared", "arrow", "method", "generator", "async"] as const);
  const declared = {
    declared: `function f(${parameters}) {\n${work}\n}`,
    arrow: `const f = (${parameters}) => {\n${work}\n};`,
    method: `const holder = {\nf(${parameters}) {\n${work}\n},\n};\nconst f = ${taken === "this" ? "holder.f" : "(...given) => holder.f(...given)"};`,
    generator: `function* steps(${parameters}) {\n${work.replace(/^return /gm, "yield ")}\n}\nconst f = (...given) => steps(...given).next().value;`,
    async: `async function later(${parameters}) {\n${work}\n}\nconst f = later;`,
  }[kind];
  const waits = kind === "async";
  const call = (n: string) => {
    const given = argument(n);
    const text =
      taken === "this"
        ? `f.call(${given})`
        : taken === "default" && random.chance(0.5)
          ? "f()"
          : random.pick([
              `f(${given})`,
              `f(${given})`,
              `f(${given})`,
              `f.apply(null, [${given}])`,
              `f(...[${given}])`,
              `[${given}].map(each => f(each))[0]`,
            ]);
    return waits ? `await ${text}` : text;
  };
  const shows = (text: string) =>
    `try {\nconst answer = ${text};\nconsole.log(typeof answer === "function" ? JSON.stringify(answer()) : typeof answer === "object" ? JSON.stringify(answer) : String(answer));\n} catch (thrown) {\nconsole.log("thrown", thrown instanceof Error ? thrown.constructor.name : JSON.stringify(thrown));\n}`;
  const calls = random.pick([
    [shows(call("1"))],
    [shows(call("1")), shows(call("2"))],
    [shows(call("1")), shows(call("2"))],
    [`for (let n = 1; n < 4; n++) {\n${shows(call("n"))}\n}`],
  ]);
  const behind = [
    work.includes("kept.push") ? "Bun.gc(true);\nconsole.log(JSON.stringify(kept), kept[0] === kept.at(-1));" : "",
    work.includes("map.set") ? "console.log([...map.keys()].map(key => JSON.stringify(key)).join());" : "",
  ]
    .filter(Boolean)
    .join("\n");
  const all = declared + calls.join("\n");
  const head = [
    all.includes("new Pair") ? "class Pair {\nconstructor(a, b) {\nthis.a = a;\nthis.b = b;\n}\n}" : "",
    work.includes("kept.push") ? "const kept = [];" : "",
    work.includes("last") ? "let last = null;" : "",
    work.includes("map.set") ? "const map = new Map();" : "",
    work.includes("other(") ? "function other(given) {\ngiven.seen = true;\nreturn Object.keys(given).join();\n}" : "",
    declared,
  ]
    .filter(Boolean)
    .join("\n");
  const scene = [...calls, behind].filter(Boolean).join("\n");
  const isModule = waits || random.chance(0.5);
  const file = isModule ? "main.mjs" : "main.cjs";
  const where = random.pick(["top", "top", "once", "twice"] as const);
  if (where === "top") return { file, text: `${head}\n${scene}\n` };
  return {
    file,
    text: `${head}\n${waits ? "async " : ""}function run() {\n${scene}\n}\n${Array(where === "once" ? 1 : 2)
      .fill(waits ? "await run();" : "run();")
      .join("\n")}\n`,
  };
}
