// Long lists that are cut, shifted and grown: drawn sequences of `splice()`, `shift()`, `unshift()`, `push()`, `pop()` and stores to `length`, on lists of whole numbers, fractions and anything, with holes, with
// names laid on the list itself, with a collection forced between steps, and with loops that walk the list while a step is taken. Each program is one drawn sequence and is built alone.
//
//   bun write-list-moves-draws.ts <folder> [first seed] [count]      writes <folder>/<seed>-<kind>--<size>--<made>--<extras>.js
//
// A runtime that takes an element out near the head of a long list may move the few in front instead of the many behind, and then the start of the elements. What lies in front of the elements moves with
// them: the length, and the names laid on the list. Whoever holds the place of the elements across such a step holds a place that still can be read, so the mistake shows in what is read alone. Which side is
// moved hangs on how many elements lie behind the place, so the places drawn lie close to the head, round the middle and close to the end, and the lengths drawn lie round a hundred thousand too, to the
// element. After each step the program prints what the step gave back, the length, and a sum over every element, every hole and every name.
import { mkdirSync, writeFileSync } from "fs";

function drawer(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const below = (n: number) => Math.floor(next() * n);
  return { below, between: (low: number, high: number) => low + below(high - low + 1), of: <T>(list: readonly T[]): T => list[below(list.length)], chance: (p: number) => next() < p }; // prettier-ignore
}

const turn = 100000;

const head = `const code = v =>
  typeof v === "number"
    ? Object.is(v, -0)
      ? 7
      : v !== v
        ? 13
        : (v | 0) ^ ((v * 1024) | 0)
    : typeof v === "string"
      ? v.length * 17 + v.charCodeAt(0)
      : v === undefined
        ? 3
        : v === null
          ? 5
          : typeof v === "object"
            ? v.id | 0
            : 11;
function sum(list) {
  let h = list.length | 0;
  for (let i = 0; i < list.length; i++) h = (Math.imul(h, 31) + (i in list ? code(list[i]) : 1)) | 0;
  for (const name of names) h = (Math.imul(h, 31) + (name in list ? code(list[name]) : 2)) | 0;
  return h;
}
function told(step, run) {
  let gave;
  try {
    gave = run();
  } catch (error) {
    gave = error.name;
  }
  const short = Array.isArray(gave) ? gave.length + ":" + gave.slice(0, 4).map(code).join() : typeof gave === "object" && gave ? "o" + code(gave) : String(gave);
  console.log(step, short, a.length, sum(a));
}
function walked(list, from, to, at, deed) {
  let h = 0;
  for (let i = from; i < to && i < list.length; i++) {
    h = (Math.imul(h, 31) + code(list[i])) | 0;
    if (i === at) deed();
  }
  return h;
}
function walkedByOf(list, turns, at, deed) {
  let h = 0,
    seen = 0;
  for (const one of list) {
    h = (Math.imul(h, 31) + code(one)) | 0;
    if (seen === at) deed();
    if (++seen >= turns) break;
  }
  return h;
}
const given = JSON.parse(process.argv[9] ?? "GIVEN");
const names = [];`;

function write(seed: number): { name: string; text: string } {
  const draw = drawer(seed);
  const kind = draw.of(["whole-numbers", "fractions", "anything"] as const);
  const size = draw.of([
    "some-thousands",
    "over-a-hundred-thousand",
    "over-a-hundred-thousand",
    "at-the-turn",
  ] as const);
  let length = size === "some-thousands" ? draw.between(9000, 40000) : size === "at-the-turn" ? turn + draw.between(0, 70) : draw.between(turn + 10, 260000); // prettier-ignore
  const element =
    kind === "whole-numbers" ? "i" : kind === "fractions" ? "i + 0.5" : 'i % 3 ? "s" + (i % 7) : { id: i }';
  const item = () =>
    kind === "whole-numbers" && !draw.chance(0.04)
      ? String(draw.between(-9, 99))
      : kind === "fractions" && !draw.chance(0.04)
        ? draw.of(["0.25", "1.5", "-0", "NaN", "7", "1e300"])
        : draw.of(['"x"', "{ id: 5 }", "null", "undefined", "3", "2.5", '"longer text"']);
  const made = draw.of(["pushed", "from-a-length", "stored-by-index", "filled", "a-subclass"] as const);
  const makes = {
    "pushed": `const a = [];\nfor (let i = 0; i < ${length}; i++) a.push(${element});`,
    "from-a-length": `const a = Array.from({ length: ${length} }, (_, i) => (${element}));`,
    "stored-by-index": `const a = new Array(${length});\nfor (let i = 0; i < ${length}; i++) a[i] = ${element};`,
    "filled": `const a = new Array(${length}).fill(0).map((_, i) => (${element}));`,
    "a-subclass": `class Long extends Array {}\nconst a = new Long();\nfor (let i = 0; i < ${length}; i++) a.push(${element});`,
  }[made];
  const extras: string[] = [];
  const lines: string[] = [makes];
  if (draw.chance(0.45)) {
    extras.push("holes");
    const holes = draw.between(1, 6);
    for (let k = 0; k < holes; k++) lines.push(`delete a[${draw.of([draw.between(0, 70), Math.floor(length / 2) + draw.between(-3, 3), length - 1 - draw.between(0, 70)])}];`); // prettier-ignore
  }
  let named = 0;
  const name = () => {
    const laid = `p${named++}`;
    return `names.push("${laid}");\na.${laid} = ${item()};`;
  };
  if (draw.chance(0.5)) {
    extras.push("names");
    const many = draw.of([1, 2, 5, 9, 17]);
    for (let k = 0; k < many; k++) lines.push(name());
  }
  if (draw.chance(0.08)) {
    extras.push("a-prototype-with-an-index");
    lines.push(`Object.setPrototypeOf(a, Object.create(Array.prototype, { ${draw.between(0, 40)}: { value: "up", writable: true, configurable: true } }));`); // prettier-ignore
  }
  const table: number[] = [];
  const outOfData = draw.chance(0.5);
  if (outOfData) extras.push("places-out-of-data");
  const number = (n: number) => (outOfData ? `given[${table.push(n) - 1}]` : String(n));
  // A place in a list of `length`, with `taken` elements to go.
  const place = (taken: number) => {
    const drawn = draw.of([
      draw.between(1, 60),
      draw.between(1, 60),
      draw.between(0, 2),
      Math.floor(length / 2) + draw.between(-3, 3),
      length - taken - turn + draw.between(-1, 1),
      length - draw.between(0, 60),
      draw.below(length + 1),
    ]);
    return Math.max(0, Math.min(length, drawn));
  };
  const items = (most: number) => Array.from({ length: draw.between(1, most) }, item);
  // One change of the list, as an expression, with the length kept up.
  const change = (): string => {
    switch (
      draw.of(["out", "out", "out", "in", "in", "in", "both", "shift", "unshift", "push", "pop", "by-call"] as const)
    ) {
      case "out": {
        const taken = draw.of([1, 1, 1, 2, 3, 8, 1000]);
        const at = place(taken);
        length -= Math.min(taken, length - at);
        return `a.splice(${number(at)}, ${number(taken)})`;
      }
      case "in": {
        const put = items(draw.of([1, 1, 2, 4, 9]));
        const at = place(0);
        length += put.length;
        return `a.splice(${number(at)}, 0, ${put.join(", ")})`;
      }
      case "both": {
        const taken = draw.between(1, 5);
        const put = items(5);
        const at = place(taken);
        length += put.length - Math.min(taken, length - at);
        return `a.splice(${number(at)}, ${number(taken)}, ${put.join(", ")})`;
      }
      case "shift":
        if (length) length--;
        return "a.shift()";
      case "unshift": {
        const put = items(3);
        length += put.length;
        return `a.unshift(${put.join(", ")})`;
      }
      case "push": {
        const put = items(3);
        length += put.length;
        return `a.push(${put.join(", ")})`;
      }
      case "pop":
        if (length) length--;
        return "a.pop()";
      case "by-call": {
        const at = place(1);
        length -= Math.min(1, length - at);
        return `Array.prototype.splice.call(a, ${number(at)}, 1)`;
      }
    }
  };
  const steps = draw.between(12, 40);
  for (let step = 0; step < steps; step++) {
    const what = draw.of(["change", "change", "change", "change", "change", "length", "hole", "store", "name", "no-name", "collect", "walk", "walk", "walk-by-of", "read"] as const); // prettier-ignore
    if (what === "change") lines.push(`told(${step}, () => ${change()});`);
    else if (what === "length") {
      length = Math.max(0, length + draw.of([-1, -3, -70, 1, 5, 40]));
      lines.push(`told(${step}, () => (a.length = ${number(length)}));`);
    } else if (what === "hole")
      lines.push(`told(${step}, () => delete a[${number(Math.min(place(0), Math.max(0, length - 1)))}]);`);
    else if (what === "store")
      lines.push(`told(${step}, () => (a[${number(Math.min(place(0), Math.max(0, length - 1)))}] = ${item()}));`);
    else if (what === "name") lines.push(name(), `told(${step}, () => names.length);`);
    else if (what === "no-name") lines.push(`told(${step}, () => delete a.p${draw.below(Math.max(1, named))});`);
    else if (what === "collect") lines.push(`told(${step}, () => (Bun.gc(true), 0));`);
    else if (what === "walk") {
      const from = Math.max(0, place(0) - draw.between(0, 40));
      const at = from + draw.between(0, 60);
      lines.push(
        `told(${step}, () => walked(a, ${number(from)}, ${number(from + draw.between(20, 160))}, ${number(at)}, () => ${change()}));`,
      );
    } else if (what === "walk-by-of")
      lines.push(`told(${step}, () => walkedByOf(a, ${number(draw.between(20, 160))}, ${number(draw.between(0, 60))}, () => ${change()}));`); // prettier-ignore
    else
      lines.push(
        `told(${step}, () => [a.at(-1), a[0], a[${number(place(0))}], a.indexOf(${item()}, ${number(Math.max(0, length - 50))})]);`,
      );
    if (draw.chance(0.12)) lines.push("Bun.gc(true);");
  }
  return {
    name: `${String(seed).padStart(7, "0")}-${kind}--${size}--${made}--${extras.join("-and-") || "plain"}.js`,
    text: head.replace("GIVEN", JSON.stringify(table)) + "\n" + lines.join("\n") + "\n",
  };
}

const [folder, first, count] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? 1000)];
mkdirSync(folder, { recursive: true });
for (let seed = first; seed < first + count; seed++) {
  const program = write(seed);
  writeFileSync(`${folder}/${program.name}`, program.text);
}
console.log(count);
