// Arrays that had elements inserted or removed at the front, then are read, written, swapped, sorted and resized
// while the program allocates enough garbage to keep the garbage collector running.
//
//   elements   integers, doubles, a mix of both, strings, objects, nested arrays, numbers mixed with strings
//   length     from 10 to 20,000
//   the front  unshift, shift, splice at index 0 or 1, several of them, or nothing
//   or         many arrays stay alive; each is changed at the front, and later gets an element of another kind
//   or         sort after sort, each behind a change at the front, with a comparator that allocates
//   the loop   swaps by destructuring, stores, reads, push and pop; now and then sort, reverse, indexOf, includes,
//              slice, fill, copyWithin, for-of, spread, a rest pattern, another unshift or shift
//   printed    per scene: the length, a hash of all elements, and a running sum of what was read
import type { Random } from "./random";

interface Kind {
  type: string;
  make: (index: string) => string;
  compare: string;
  isNumeric: boolean;
}

const kinds: Kind[] = [
  { type: "number", make: i => `(${i}) | 0`, compare: "(x, y) => x - y", isNumeric: true },
  { type: "number", make: i => `(${i}) + 0.5`, compare: "(x, y) => x - y", isNumeric: true },
  {
    type: "number",
    make: i => `((${i}) & 1 ? (${i}) | 0 : (${i}) + 0.25)`,
    compare: "(x, y) => x - y",
    isNumeric: true,
  },
  { type: "string", make: i => `"s" + (${i})`, compare: "(x, y) => (x < y ? -1 : x > y ? 1 : 0)", isNumeric: false },
  { type: "{ a: number; b: string }", make: i => `({ a: (${i}) | 0, b: "t" })`, compare: "(x, y) => x.a - y.a", isNumeric: false }, // prettier-ignore
  { type: "number[]", make: i => `[(${i}) | 0, 1.5]`, compare: "(x, y) => x[0] - y[0]", isNumeric: false },
  { type: "number | string", make: i => `((${i}) % 3 ? (${i}) | 0 : "s" + (${i}))`, compare: "(x, y) => mix(x) - mix(y)", isNumeric: false }, // prettier-ignore
];

export function generate(r: Random, typed: boolean): string {
  const scenes: string[] = [];
  const count = 2 + r.below(4);
  for (let scene = 0; scene < count; scene++) {
    const kind = r.pick(kinds);
    const length = r.pick([10, 100, 129, 130, 200, 1000, 2000, 5000, 20000]);
    const make = kind.make;
    const front = r.pick([
      `list.splice(0, 0, ${make("-1")});`,
      `list.splice(0, 0, ${make("-1")});`,
      `list.unshift(${make("-1")});`,
      `list.unshift(${make("-1")}, ${make("-2")}, ${make("-3")});`,
      `list.shift();`,
      `list.splice(0, 1);`,
      `list.splice(0, 3);`,
      `list.splice(1, 0, ${make("-1")});`,
      `for (let k = 0; k < 5; k++) list.unshift(${make("-k")});`,
      `list.shift(); list.unshift(${make("-1")});`,
      `for (let k = 0; k < 40; k++) list.shift();`.replace("40", String(Math.min(40, length >> 2))),
      `list.reverse();`,
      ``,
    ]);
    const always = [
      `[list[at], list[other]] = [list[other], list[at]];`,
      `list[at] = ${make("round")};`,
      `sum = (sum + mix(list[at])) | 0;`,
      `sum = (sum + mix(list[other])) | 0;`,
      `list.push(${make("round")}); list.pop();`,
      `{ const held = list[at]; list[at] = list[other]; list[other] = held; }`,
      `sum = (sum + list.length) | 0;`,
    ];
    const seldom = [
      length <= 2000 ? `list.sort(${kind.compare});` : `sum = (sum + mix(list.at(-1))) | 0;`,
      length <= 5000 ? `list.reverse();` : `sum = (sum + mix(list.at(-2))) | 0;`,
      `sum = (sum + list.indexOf(list[other])) | 0;`,
      `sum = (sum + (list.includes(list[at]) ? 1 : 0)) | 0;`,
      `sum = (sum + list.slice(at, at + 5).length) | 0;`,
      `list.fill(${make("round")}, at, at + 2);`,
      `list.copyWithin(0, 1, 4);`,
      `{ let seen = 0; for (const each of list) { sum = (sum + mix(each)) | 0; if (++seen > 50) break; } }`,
      `{ const [first, second, ...rest] = list.slice(0, 8); sum = (sum + mix(first) + mix(second) + rest.length) | 0; }`,
      `sum = (sum + [...list.slice(0, 6)].length) | 0;`,
      `list.unshift(${make("round")}); list.shift();`,
      `list.shift(); list.push(${make("round")});`,
      `list.splice(at, 1, ${make("round")});`,
      `list.splice(0, 0, ${make("round")}); list.pop();`,
      `sum = (sum + list.lastIndexOf(list[other])) | 0;`,
      `sum = (sum + list.map(mix).length + list.filter(each => mix(each) & 1).length) | 0;`.replace(/^.*$/, whole =>
        length <= 2000 ? whole : `sum = (sum + (0 in list ? 1 : 0)) | 0;`,
      ),
      kind.isNumeric
        ? `sum = (sum + Math.max(...list.slice(0, 10))) | 0;`
        : `sum = (sum + list.slice(0, 4).join().length) | 0;`,
      `list.length = list.length - 1; list.push(${make("round")});`,
    ];
    const body: string[] = [];
    for (let k = 2 + r.below(4); k > 0; k--) body.push(r.pick(always));
    const rare: string[] = [];
    for (let k = 1 + r.below(4); k > 0; k--)
      rare.push(
        `if ((round & ${r.pick([255, 511, 1023])}) === ${r.below(200)}) ${r.pick(seldom).replace(/^([^{].*)$/, "{ $1 }")}`,
      );
    const list = typed ? `const list: Array<${kind.type}> = [];` : `const list = [];`;
    if (r.chance(0.2)) {
      // Many arrays stay alive. Each is changed at the front while young; later it gets an element of another kind, so its storage changes kind.
      const size = r.pick([129, 140, 200, 300]);
      const alive = r.pick([15, 63, 255]);
      const first = r.pick(["i", "i", "i + 0.5", '"s" + i']);
      const later = () =>
        r.pick([
          "0.5",
          "round + 0.25",
          '"text"',
          '{ a: round, b: "t" }',
          "[round, 1.5]",
          "undefined",
          "null",
          "round",
          "-0",
          "NaN",
        ]);
      const steps = [
        `old[round % old.length] = ${later()};`,
        `old[round % old.length] = ${later()};`,
        `old.push(${later()});`,
        `old.unshift(${later()});`,
        `old.shift();`,
        `old.splice(0, 1, ${later()});`,
        `old.fill(${later()}, 0, 2);`,
        `old[old.length + ${r.pick([0, 1, 5])}] = ${later()};`,
        `old.length = ${size >> 1};`,
        `old.reverse();`,
        `[old[0], old[1]] = [old[1], old[0]];`,
        `sum = (sum + old.indexOf(${later()})) | 0;`,
        `old.sort();`,
        `delete old[2];`,
      ];
      scenes.push(`function scene${scene}()${typed ? ": void" : ""} {
  const lists${typed ? ": any[][]" : ""} = [];
  let sum = 0;
  for (let round = 0; round < ${r.pick([2000, 6000, 15000])}; round++) {
    const list${typed ? ": any[]" : ""} = [];
    for (let i = 0; i < ${size}; i++) list.push(${first});
    ${r.pick(["list.shift();", "list.unshift(-1);", "list.splice(0, 0, -1);", "list.splice(0, 2);", "list.shift(); list.shift();"])}
    lists[round & ${alive}] = list;
    const old = lists[(round * 7) & ${alive}];
    if (old !== undefined) {
      ${r.sample(steps, 2 + r.below(3)).join("\n      ")}
      sum = (sum + mix(old[3]) + mix(old[old.length - 1]) + old.length) | 0;
    }
    if ((round & ${r.pick([1, 3, 15])}) === 0) churn(${r.pick([20, 100, 400])});
  }
  let all = 0;
  for (const list of lists) for (let i = 0; i < list.length; i += 7) all = (Math.imul(all, 31) + mix(list[i])) | 0;
  console.log("scene ${scene} kinds", lists.length, all, sum);
}
scene${scene}();`);
      continue;
    }
    if (r.chance(0.3)) {
      // Sorts without end: the front moves before each sort, and the comparator allocates now and then.
      const size = r.pick([129, 130, 200, 400, 600]);
      const compare =
        kind.compare.replace(
          "=> ",
          `=> ((++calls & ${r.pick([15, 63, 255])}) === 0 && churn(${r.pick([2, 8, 40])}), `,
        ) + ")";
      scenes.push(`function scene${scene}()${typed ? ": void" : ""} {
  ${list}
  for (let i = 0; i < ${size}; i++) list.push(${make(`(i * 7919) % ${size}`)});
  ${front}
  let sum = 0;
  let calls = 0;
  for (let round = 0; round < ${r.pick([300, 1000, 2500])}; round++) {
    ${r.pick([`list.shift(); list.push(${make("round % 97")});`, `list.pop(); list.unshift(${make("round % 97")});`, `list.splice(0, 2); list.push(${make("round % 89")}, ${make("round % 83")});`])}
    list.sort(${r.chance(0.7) ? compare : kind.compare});
    sum = (sum + mix(list[round % list.length]) + mix(list[0])) | 0;
    if ((round & ${r.pick([1, 7, 31])}) === 0) churn(${r.pick([50, 200, 800])});
  }
  let all = 0;
  for (let i = 0; i < list.length; i++) all = (Math.imul(all, 31) + mix(list[i])) | 0;
  console.log("scene ${scene} sorted", list.length, all, sum, calls > 0);
}
scene${scene}();`);
      continue;
    }
    const turns = r.pick([50000, 150000, 400000]);
    scenes.push(`function scene${scene}()${typed ? ": void" : ""} {
  ${list}
  for (let i = 0; i < ${length}; i++) list.push(${make("i")});
  ${front}
  let sum = 0;
  for (let round = 0; round < ${turns}; round++) {
    const at = 1 + (round % (list.length - 1));
    const other = round % 7;
    ${body.join("\n    ")}
    ${rare.join("\n    ")}
    if ((round & ${r.pick([15, 63, 255])}) === 0) churn(${r.pick([20, 100, 400])});
  }
  let all = 0;
  for (let i = 0; i < list.length; i++) all = (Math.imul(all, 31) + mix(list[i])) | 0;
  console.log("scene ${scene}", list.length, all, sum);
}
scene${scene}();`);
  }
  const any = typed ? ": any" : "";
  return `const junk${typed ? ": unknown[]" : ""} = [];
function churn(count${typed ? ": number" : ""})${typed ? ": void" : ""} {
  for (let i = 0; i < count; i++) junk[i & 1023] = { name: "x" + i, list: [i, i + 0.5] };
}
function mix(value${any})${typed ? ": number" : ""} {
  if (typeof value === "number") return (value * 4) | 0;
  if (typeof value === "string") return (value.length * 131 + value.charCodeAt(value.length - 1)) | 0;
  if (value === undefined || value === null) return 7;
  if (Array.isArray(value)) return (value[0] * 3 + value.length) | 0;
  return (value.a * 5 + value.b.length) | 0;
}
${scenes.join("\n")}
`;
}
