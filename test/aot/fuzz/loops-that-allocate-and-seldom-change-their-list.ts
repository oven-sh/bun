// A hot loop reads a list and allocates something in every iteration. A compiler may read the list's storage, length and
// kind once in front of the loop, because an allocation leaves them alone, and may go back to that fast form after an
// iteration that took a slow path. So every now and then an iteration changes what was read in front of the loop: the list
// grows, shrinks, changes its kind of storage, gets a hole or an accessor, or is replaced by another list. The change stands
// in the loop, in a function, in a constructor that the allocation runs, or in text made at run time.
import type { Random } from "./random";

/** Expressions that allocate. `i` is the iteration. */
const allocations = [
  "{ n: i }",
  "{ n: i }",
  "[i, i + 1]",
  "[i, i + 1]",
  "() => i",
  "new POINT(i)",
  "{ ...base }",
  "[...pair]",
  "new Map()",
  "new Array(2)",
  "{ n: i + 0.5, m: [i] }",
  "String(i) + name",
  "{ [name]: i }",
  "[1, 2, 3]",
];

/** Expressions that read the list. */
const reads = [
  "list[i & 3]",
  "list[i & 3]",
  "list[0]",
  "list.length",
  "list.length",
  "list[list.length - 1]",
  "list[i % (list.length || 1)]",
  "list.at(-1)",
  "list[1]",
  "list[i & 7]",
];

/** Statements of the seldom taken path. `loose` is the list without its type. */
const changes = [
  "list.push(i);",
  "list.push(i);",
  "list.pop();",
  "list.shift();",
  "list.unshift(i);",
  "list.length = 2;",
  "list.length = 0;\n      list.push(1, 2, 3, 4);",
  "list[i & 3] = i;",
  "list[0] = i;",
  "list[0] = 0.5;",
  'loose[1] = "text";',
  "loose[1] = { n: 1 };",
  "list[list.length + 3] = 1;",
  "delete list[1];",
  "list.splice(1, 1);",
  "list.reverse();",
  "list.sort();",
  "list.fill(i);",
  "list[5000 + i] = 1;",
  'Object.defineProperty(list, "0", { get: () => 77, configurable: true });',
  "Object.freeze(list);",
  "list = other;",
  "list = list.slice();",
  "list = [9, 8, 7, 6];",
  "list = i & 1 ? [9, 8, 7, 6] : [0.5, 1.5];",
  "CHANGE(list, i);",
  "CHANGE(list, i);",
  "byText(list, i);",
  "byText(list, i);",
  "list.copyWithin(0, 1);",
  "list.length = list.length + 2;",
];

const lists = [
  "[1, 2, 3, 4]",
  "[1, 2, 3, 4]",
  "[1, 2, 3, 4, 5, 6, 7, 8, 9]",
  "[0.5, 1.5, 2.5, 3.5]",
  "[1]",
  "[]",
  "[1, , 3, 4]",
  "Array.from({ length: 6 }, (unused, at) => at * 2)",
  "new Array(4).fill(3)",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 6); scene < total; scene++) {
    const fill = (text: string) => text.replaceAll("POINT", `Point${scene}`).replaceAll("CHANGE", `change${scene}`);
    const isPlain = random.chance(0.4);
    const allocation = fill(random.pick(isPlain ? allocations.slice(0, 5) : allocations));
    const change = fill(random.pick(isPlain ? changes.slice(0, 10) : changes));
    const inFunction = fill(
      random.pick(changes.filter(each => !each.includes("CHANGE") && !each.startsWith("list = "))),
    );
    const take = (read: string) =>
      `value = ${read};\n    sum = (sum * 7 + (typeof value === "number" && value === value ? value : 13)) % 1000003;`;
    const isFirst = random.chance(0.3);
    const seldom = `if (i % every === every - 1) {\n      ${change}\n    }`;
    const home = isPlain ? "parameter" : random.pick(["parameter", "parameter", "field", "module"]);
    const isCarried = !isPlain && random.chance(0.25);
    const head = random.pick(
      isPlain
        ? ["for (let i = 0; i < turns; i++)"]
        : [
            "for (let i = 0; i < turns; i++)",
            "for (let i = 0; i < turns; i++)",
            "for (let i = 0; i < list.length && i < turns; i++)",
            "for (let i = turns - 1; i >= 0; i--)",
          ],
    );
    const isChangedByConstructor = allocation.includes("new Point") && random.chance(0.5);
    const start = home === "field" ? "let list = box.list;" : home === "module" ? `let list = shared${scene};` : "";
    const again = home === "field" ? "list = box.list;" : home === "module" ? `list = shared${scene};` : "";
    const store =
      home === "field"
        ? change.replace(/^list = /, "box.list = ")
        : home === "module"
          ? change.replace(/^list = /, `shared${scene} = `)
          : change;
    const path = `if (i % every === every - 1) {\n      ${store}\n    }`;
    scenes.push(`let shared${scene}${as("number[]")} = [];
let seen${scene}${as("number[]")} = [];
class Point${scene} {
  x${as("number")};
  constructor(x${as("number")}) {
    this.x = x;
    ${isChangedByConstructor ? `if (x % 50 === 49) {\n      const list = seen${scene};\n      const loose${as("any")} = list;\n      const i = x;\n      ${inFunction}\n    }` : ""}
  }
}
function change${scene}(list${as("number[]")}, i${as("number")}) {
  const loose${as("any")} = list;
  ${inFunction}
}
function walk${scene}(${home === "field" ? `box${as("{ list: number[] }")}` : home === "module" ? "" : `list${as("number[]")}`}${home === "module" ? "" : ", "}turns${as("number")}, every${as("number")})${as("string")} {
  ${start}
  const kept${as("unknown[]")} = [];
  const other = [40, 30, 20, 10, 0];
  let sum = 0;
  let value${as("unknown")};
  ${isCarried ? "let last = list[0];" : ""}
  ${head} {
    const loose${as("any")} = list;
    ${isFirst ? (home === "parameter" ? seldom : path) : ""}
    kept[i & 7] = ${allocation};
    ${take(random.pick(reads))}
    ${random.chance(0.5) ? take(random.pick(reads)) : ""}
    ${isCarried ? `${take("last")}\n    last = list[0];` : ""}
    ${isFirst ? "" : home === "parameter" ? seldom : path}
    ${again}
  }
  return sum + " " + list.length + " " + kept.length + " " + String(list.slice(0, 6).map(each => typeof each + String(each)));
}
for (const [turns, every] of [${random
      .sample(
        [
          "[300, 7]",
          "[300, 50]",
          "[2000, 400]",
          "[20000, 3000]",
          "[100, 1]",
          "[100, 1000]",
          "[0, 1]",
          "[5, 2]",
          "[3000, 64]",
        ],
        random.between(2, 4),
      )
      .join(", ")}]${typed ? " as [number, number][]" : ""}) {
  const list${as("number[]")} = ${random.pick(lists)}${typed ? " as number[]" : ""};
  seen${scene} = list;
  shared${scene} = list;
  try {
    console.log("scene ${scene}", turns, every, walk${scene}(${home === "field" ? "{ list }, " : home === "module" ? "" : "list, "}turns, every), list.length);
  } catch (error) {
    console.log("scene ${scene}", turns, every, ${typed ? "(error as Error)" : "error"}.name, list.length);
  }
}`);
  }
  return `const byText${as("any")} = Function("list", "i", "if (i & 1) list.push(i); else list[0] = i + 0.5;");
const base = { a: 1, b: 2 };
const pair = [1, 2];
const name${as("string")} = Function("return 'made'")();
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}
