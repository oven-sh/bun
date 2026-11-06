// Small programs about one thing that is walked and one change that is made to it in the middle of the walk. A walk over a list asks for its length and its next element at every step; a `Map` or a `Set`
// shows what is added ahead of the end and skips what is deleted; `for in` and the methods of lists take their bounds at the start. There is one scene, and every line is printed at once.
//
//   the thing    a list of numbers, of texts, with a hole, an instance of a class below `Array`, a typed array over a buffer that can be resized, a `Map`, a `Set`, an object
//   the walk     `for of`, `entries`, `keys`, `values`, `forEach`, `map`, `filter`, `flatMap`, `reduce`, `some`, `find`, `Array.from`, `for in`, `Object.keys`, `Object.entries`, a counted loop up to
//                `length`, one whose bound is read once, `yield*`, an iterator that is asked by hand
//   the change   `push`, `pop`, `shift`, `unshift`, `splice`, `length`, a store ahead or behind, `delete`, `sort`, `reverse`, `fill`; `set`, `add`, `delete`, `clear`; `resize`; another list into the
//                variable; on the first turn, on the second, on every turn up to a bound
//   made by      the body of the loop, the callback, a function that the body calls
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string } {
  const kind = random.weighted([
    [8, "list"],
    [2, "texts"],
    [1, "hole"],
    [2, "heir"],
    [3, "map"],
    [3, "set"],
    [2, "object"],
    [1, "bytes"],
  ] as const);
  const made = {
    list: "[1, 2, 3, 4]",
    texts: '["a", "b", "c"]',
    hole: "[1, , 3, 4]",
    heir: "List.from([1, 2, 3, 4])",
    map: 'new Map([\n[1, "a"],\n[2, "b"],\n[3, "c"],\n])',
    set: "new Set([1, 2, 3])",
    object: "{ a: 1, b: 2, c: 3 }",
    bytes: "new Uint8Array(buffer)",
  }[kind];
  const isAList = kind === "list" || kind === "texts" || kind === "hole" || kind === "heir";
  const changes = isAList
    ? [
        "t.push(9)",
        "t.push(9)",
        "t.pop()",
        "t.shift()",
        "t.unshift(0)",
        "t.splice(1, 1)",
        "t.splice(1, 0, 8, 8)",
        "t.length = 2",
        "t.length = 0",
        "t[3] = 7",
        "t[0] = 7",
        "t[6] = 7",
        "delete t[2]",
        "t.sort((p, q) => (p < q ? 1 : -1))",
        "t.reverse()",
        "t.fill(5)",
        "t = [7, 8]",
        "t.length = 6",
      ]
    : kind === "map"
      ? [
          't.set(9, "z")',
          "t.delete(2)",
          "t.delete(1)",
          "t.clear()",
          't.set(2, "changed")',
          't.delete(3), t.set(3, "again")',
          't = new Map([[7, "other"]])',
        ]
      : kind === "set"
        ? ["t.add(9)", "t.delete(2)", "t.delete(1)", "t.clear()", "t.delete(3), t.add(3)", "t = new Set([7])"]
        : kind === "object"
          ? ["t.d = 4", "delete t.b", "delete t.c", "t.b = 9", "delete t.a", "t[0] = 0", "t = { z: 26 }"]
          : ["buffer.resize(2)", "buffer.resize(8)", "t[3] = 7", "t.fill(5)", "buffer.resize(0)"];
  const change = random.pick(changes);
  const turn = random.pick(["turns === 1", "turns === 1", "turns === 2", "turns < 4", "turns === 3"]);
  const by = random.pick(["body", "body", "body", "function"] as const);
  const alters = by === "function" && !change.startsWith("t = ") ? "alter();" : `${change};`;
  const step = (shown: string) =>
    `turns++;\nconsole.log(${shown});\nif (${turn}) ${alters}\nif (turns > 12) throw new Error("too many turns");`;

  const walks: [number, string][] = isAList
    ? [
        [6, `for (const each of t) {\n${step("each")}\n}`],
        [2, `for (const [index, each] of t.entries()) {\n${step("index, each")}\n}`],
        [1, `for (const index of t.keys()) {\n${step("index")}\n}`],
        [3, `t.forEach((each, index) => {\n${step("index, each")}\n});`],
        [3, `console.log(\nJSON.stringify(\nt.map(each => {\n${step("each")}\nreturn each;\n}),\n),\n);`],
        [2, `console.log(\nJSON.stringify(\nt.filter(each => {\n${step("each")}\nreturn true;\n}),\n),\n);`],
        [1, `console.log(\nt.reduce((sum, each) => {\n${step("each")}\nreturn sum + String(each);\n}, ""),\n);`],
        [1, `console.log(\nt.some(each => {\n${step("each")}\nreturn false;\n}),\n);`],
        [1, `console.log(\nt.find(each => {\n${step("each")}\nreturn false;\n}),\n);`],
        [3, `for (let i = 0; i < t.length; i++) {\n${step("i, t[i]")}\n}`],
        [2, `for (let i = 0, n = t.length; i < n; i++) {\n${step("i, t[i]")}\n}`],
        [1, `for (const index in t) {\n${step("index, t[index]")}\n}`],
        [1, `console.log(\nJSON.stringify(\nArray.from(t, each => {\n${step("each")}\nreturn each;\n}),\n),\n);`],
        [1, `function* all() {\nyield* t;\n}\nfor (const each of all()) {\n${step("each")}\n}`],
        [
          1,
          `const walk = t[Symbol.iterator]();\nfor (let next = walk.next(); !next.done; next = walk.next()) {\n${step("next.value")}\n}`,
        ],
        [1, `console.log(\nJSON.stringify(\nt.flatMap(each => {\n${step("each")}\nreturn [each];\n}),\n),\n);`],
      ]
    : kind === "map"
      ? [
          [5, `for (const [key, value] of t) {\n${step("key, value")}\n}`],
          [2, `for (const key of t.keys()) {\n${step("key")}\n}`],
          [2, `for (const value of t.values()) {\n${step("value")}\n}`],
          [3, `t.forEach((value, key) => {\n${step("key, value")}\n});`],
          [
            1,
            `const walk = t.entries();\nfor (let next = walk.next(); !next.done; next = walk.next()) {\n${step("next.value.join()")}\n}`,
          ],
        ]
      : kind === "set"
        ? [
            [5, `for (const each of t) {\n${step("each")}\n}`],
            [3, `t.forEach(each => {\n${step("each")}\n});`],
            [1, `for (const [one, other] of t.entries()) {\n${step("one, other")}\n}`],
          ]
        : kind === "object"
          ? [
              [5, `for (const key in t) {\n${step("key, t[key]")}\n}`],
              [3, `for (const key of Object.keys(t)) {\n${step("key, t[key]")}\n}`],
              [2, `for (const [key, value] of Object.entries(t)) {\n${step("key, value, t[key]")}\n}`],
            ]
          : [
              [4, `for (const each of t) {\n${step("each")}\n}`],
              [2, `t.forEach((each, index) => {\n${step("index, each")}\n});`],
              [2, `for (let i = 0; i < t.length; i++) {\n${step("i, t[i]")}\n}`],
            ];
  const walk = random.weighted(walks);
  const last =
    kind === "map" || kind === "set"
      ? "console.log(turns, t.size, JSON.stringify([...t]));"
      : kind === "bytes"
        ? "console.log(turns, t.length, t.join());"
        : "console.log(turns, JSON.stringify(t));";
  const scene = [
    kind === "bytes" ? "const buffer = new ArrayBuffer(4, { maxByteLength: 8 });" : "",
    `let t = ${made};`,
    kind === "bytes" ? "t.set([1, 2, 3, 4]);" : "",
    "let turns = 0;",
    alters === "alter();" ? `const alter = () => {\n${change};\n};` : "",
    walk,
    last,
  ]
    .filter(Boolean)
    .join("\n");
  const head = kind === "heir" ? "class List extends Array {}\n" : "";
  const guarded = (text: string) =>
    `try {\n${text}\n} catch (error) {\nconsole.log("THROWS", error.constructor.name);\n}`;
  const file = random.chance(0.5) ? "main.mjs" : "main.cjs";
  const where = random.pick(["top", "once", "once", "twice"] as const);
  if (where === "top") return { file, text: `${head}${guarded(scene)}\n` };
  return {
    file,
    text: `${head}function run() {\n${scene}\n}\n${guarded(where === "once" ? "run();" : "run();\nrun();")}\n`,
  };
}
