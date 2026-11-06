// Small programs about one short loop of a hundred turns. Every turn reads one piece of state, in a test, a sum, the bound of the loop or a call; on one turn, or a few, an arm that is seldom taken changes
// that state by one road. The turns behind it see the change. There is one scene, and every line is printed at once, by `console.log` itself.
//
//   the state    a member of an object that is handed in or made there, of an inner object, of `this`; a variable that a closure stores to, a variable of the file; the length or an element of a
//                list, an element of a typed array, the size of a `Map`; a function that a member holds; what a getter answers
//   read in      a test with two arms, a sum, the bound of the loop, a call, an index
//   the rare arm  one turn early, in the middle or late, every fiftieth turn, a handler of something thrown on one turn, the far side of `&&`, a `switch`
//   the road     a store, a store under another name for the same object, a method, a closure, a function that is handed the object, `delete`, `Object.defineProperty` with a getter, another
//                prototype, `Object.assign`, methods of lists, `length`, another object into the variable
//   the loop     `for`, `while`, `do`, `for of` over a list of numbers, `forEach`
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string } {
  const at = random.pick(["3", "50", "97", "0", "99"]);
  type State = {
    outside?: string;
    parameters?: string;
    given?: string;
    setup: string;
    read: string;
    changes: string[];
    last: string;
  };
  const object = (o: string): string[] => [
    `${o}.on = 0`,
    `${o}.on = 0`,
    `${o}.on = 2.5`,
    `${o}.on = "t"`,
    `${o}.on++`,
    `${o}["on"] = 0`,
    `delete ${o}.on`,
    `Object.assign(${o}, { on: 0 })`,
    `Object.defineProperty(${o}, "on", { get: () => 7 })`,
    `Reflect.set(${o}, "on", 0)`,
    `({ on: ${o}.on } = { on: 0 })`,
    `(Object.setPrototypeOf(${o}, { on: 9 }), delete ${o}.on)`,
  ];
  const states: [number, () => State][] = [
    [5, () => ({ parameters: "o", given: "{ on: 1 }", setup: "", read: "o.on", changes: object("o"), last: "o.on" })],
    [4, () => ({ setup: "const o = { on: 1 };", read: "o.on", changes: object("o"), last: "o.on" })],
    [
      4,
      () => ({
        parameters: "o, other",
        given: "one, one",
        outside: "const one = { on: 1 };",
        setup: "",
        read: "o.on",
        changes: object("other"),
        last: "o.on",
      }),
    ],
    [
      2,
      () => ({
        setup: "const o = { on: 1 };\nconst other = [o][0];",
        read: "o.on",
        changes: object("other"),
        last: "o.on",
      }),
    ],
    [
      3,
      () => ({
        outside: "class K {\non = 1;\nflip() {\nthis.on = 0;\n}\n}",
        setup: "const o = new K();",
        read: "o.on",
        changes: ["o.flip()", "o.flip()", "K.prototype.flip.call(o)", "o.on = 0"],
        last: "o.on",
      }),
    ],
    [
      3,
      () => ({
        outside: "function hook(given) {\ngiven.on = 0;\n}",
        parameters: "o",
        given: "{ on: 1 }",
        setup: "",
        read: "o.on",
        changes: ["hook(o)", "[o].forEach(hook)", "hook.call(null, o)"],
        last: "o.on",
      }),
    ],
    [
      2,
      () => ({
        setup: "const o = { inner: { on: 1 } };",
        read: "o.inner.on",
        changes: ["o.inner.on = 0", "o.inner = { on: 0 }", "o.inner = { on: 2.5 }", "delete o.inner.on"],
        last: "o.inner.on",
      }),
    ],
    [
      3,
      () => ({
        setup: "let on = 1;\nconst flip = () => {\non = 0;\n};",
        read: "on",
        changes: ["flip()", "flip()", "[0].forEach(flip)", "on = 0"],
        last: "on",
      }),
    ],
    [
      2,
      () => ({
        outside: "let on = 1;\nfunction flip() {\non = 0;\n}",
        setup: "on = 1;",
        read: "on",
        changes: ["flip()", "on = 0", "on = 2.5"],
        last: "on",
      }),
    ],
    [
      2,
      () => ({
        parameters: "o",
        given: "{ on: 1 }",
        setup: "",
        read: "o.on",
        changes: ["o = { on: 0 }", "o = { other: 1, on: 0 }", "o = { on: 2.5 }", "[o] = [{ on: 0 }]"],
        last: "o.on",
      }),
    ],
    [
      3,
      () => ({
        setup: "const list = [1, 1, 1];",
        read: "list.length",
        changes: ["list.push(1)", "list.pop()", "list.length = 0", "list[9] = 1", "list.shift()", "list.splice(0, 2)"],
        last: "list.length",
      }),
    ],
    [
      3,
      () => ({
        setup: "const list = [1, 1, 1];",
        read: "list[0]",
        changes: [
          "list[0] = 0",
          "list[0] = 2.5",
          'list[0] = "t"',
          "list.shift()",
          "list.length = 0",
          "list.unshift(0)",
          "list.reverse()",
          "list.fill(0)",
          "delete list[0]",
        ],
        last: "list[0]",
      }),
    ],
    [
      2,
      () => ({
        setup: "const bytes = new Uint8Array([1, 1]);\nconst words = new Uint16Array(bytes.buffer);",
        read: "bytes[0]",
        changes: ["words[0] = 0", "words[0] = 513", "bytes[0] = 0", "bytes.fill(0)"],
        last: "bytes[0]",
      }),
    ],
    [
      2,
      () => ({
        setup: "const map = new Map([[1, 1]]);",
        read: random.pick(["map.size", "map.get(1)"]),
        changes: ["map.set(2, 2)", "map.delete(1)", "map.clear()", "map.set(1, 0)"],
        last: "map.size",
      }),
    ],
    [
      3,
      () => ({
        setup: "const o = {\nf(n) {\nreturn 1;\n},\n};",
        read: "o.f(i)",
        changes: [
          "o.f = n => 0",
          "o.f = function (n) {\nreturn n;\n}",
          "o.f = Math.abs",
          "Object.assign(o, { f: () => 0 })",
        ],
        last: "o.f(1)",
      }),
    ],
    [
      2,
      () => ({
        setup: "let hidden = 1;\nconst o = {\nget on() {\nreturn hidden;\n},\n};",
        read: "o.on",
        changes: ["hidden = 0", "hidden++", 'Object.defineProperty(o, "on", { value: 0 })'],
        last: "o.on",
      }),
    ],
    [
      2,
      () => ({
        outside: "const holder = {\non: 1,\nrun() {\nBODY\n},\n};",
        setup: "",
        read: "this.on",
        changes: ["this.on = 0", "holder.on = 0", "delete holder.on", "holder.on = 2.5"],
        last: "this.on",
      }),
    ],
  ];
  const state = random.weighted(states)();
  const R = state.read;
  const change = random.pick(state.changes);
  const uses = random.weighted([
    [5, `if (${R}) sum += 1;\nelse sum += 100;`],
    [4, `sum += ${R};`],
    [2, `sum += ${R} === 1 ? 1 : 100;`],
    [2, `sum += [10, 20, 30, 40][${R} & 3];`],
    [1, `if (typeof ${R} === "number") sum += ${R};\nelse sum += 1000;`],
    [1, `sum = sum + ${R} + ${R};`],
  ]);
  const rare = random.weighted([
    [6, `if (i === ${at}) {\n${change};\n}`],
    [2, `if (i % 50 === 49) {\n${change};\n}`],
    [2, `i === ${at} && (${change});`],
    [2, `try {\nif (i === ${at}) throw new Error("rare");\n} catch {\n${change};\n}`],
    [1, `switch (i) {\ncase ${at}:\n${change};\nbreak;\n}`],
    [1, `if (i !== ${at}) continue;\n${change};`],
  ]);
  const first = random.chance(0.3) && !rare.includes("continue");
  const inner = first ? `${rare}\n${uses}` : `${uses}\n${rare}`;
  const isBound = (R === "list.length" || R === "map.size") && random.chance(0.5);
  const loop = isBound
    ? `for (let i = 0; i < ${R} * 20 && i < 100; i++) {\nsum += 1;\n${rare}\n}`
    : random.weighted([
        [6, `for (let i = 0; i < 100; i++) {\n${inner}\n}`],
        [rare.includes("continue") ? 0 : 2, `let i = 0;\nwhile (i < 100) {\n${inner}\ni++;\n}`],
        [rare.includes("continue") ? 0 : 1, `let i = 0;\ndo {\n${inner}\n} while (++i < 100);`],
        [2, `for (const i of turns) {\n${inner}\n}`],
        [rare.includes("continue") || /\bthis\b/.test(inner) ? 0 : 1, `turns.forEach(i => {\n${inner}\n});`],
      ]);
  const usesTurns = loop.includes("turns");
  const body = [state.setup, "let sum = 0;", loop, `console.log(sum, ${state.last});`].filter(Boolean).join("\n");
  const guarded = (text: string) =>
    `try {\n${text}\n} catch (error) {\nconsole.log("THROWS", error.constructor.name);\n}`;
  const file = random.chance(0.5) ? "main.mjs" : "main.cjs";
  const turns = usesTurns ? "const turns = Array.from({ length: 100 }, (unused, index) => index);" : "";
  if (state.outside?.includes("BODY"))
    return {
      file,
      text: `${turns ? turns + "\n" : ""}${state.outside.replace("BODY", () => body)}\n${guarded("holder.run();")}\n`,
    };
  const head = [turns, state.outside].filter(Boolean).join("\n");
  const times = state.given?.includes("one") || state.outside?.startsWith("let on") ? 1 : random.pick([1, 1, 2]);
  return {
    file,
    text: `${head ? head + "\n" : ""}function run(${state.parameters ?? ""}) {\n${body}\n}\n${guarded(
      Array(times)
        .fill(`run(${state.given ?? ""});`)
        .join("\n"),
    )}\n`,
  };
}
