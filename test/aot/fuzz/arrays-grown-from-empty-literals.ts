// Arrays that start as `[]` and grow. A program has 2 to 5 makers. Each maker writes `[]` at one or two places (a local, a property, a
// class field, a default parameter, an element of another array) and fills it in one of a dozen ways. How many elements a call adds
// follows a schedule: always the same, rising, falling, none and then many, or a jump after some hundred calls. The kind of element can
// change half way. After the fill the array is cut, emptied and filled again, frozen, sorted, given holes, or kept for later. Each maker
// runs up to some thousand times, with collections in between, and the program prints a digest of every array at fixed points.
import type { Random } from "./random";

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const cast = typed ? " as any" : "";

  const kinds = [
    { name: "integers", type: "number", value: (i: string) => `((seed + ${i}) | 0)` },
    { name: "fractions", type: "number", value: (i: string) => `(seed + ${i} + 0.5)` },
    { name: "texts", type: "string", value: (i: string) => `("t" + (seed + ${i}))` },
    { name: "points", type: "Point", value: (i: string) => `({ x: seed, y: ${i} })` },
    { name: "lists", type: "number[]", value: (i: string) => `(${i} % 3 === 0 ? [] : [seed, ${i}])` },
    {
      name: "mixed",
      type: "unknown",
      value: (i: string) =>
        `(${i} % 4 === 0 ? seed : ${i} % 4 === 1 ? seed + 0.25 : ${i} % 4 === 2 ? "m" + seed : null)`,
    },
    {
      name: "first integers, later fractions",
      type: "number",
      value: (i: string) => `(call < half ? seed + ${i} : seed + ${i} + 0.75)`,
    },
    {
      name: "first integers, later anything",
      type: "unknown",
      value: (i: string) => `(call < half ? seed + ${i} : ${i} % 2 === 0 ? "late" + ${i} : { x: seed, y: ${i} })`,
    },
  ];

  const schedules = (calls: number) => [
    `${random.pick([0, 1, 2, 3, 4, 5, 7, 8, 9, 16, 17, 33, 100])}`,
    `call % ${random.pick([2, 3, 5, 9, 17, 40])}`,
    `${random.pick([8, 20, 64])} - (call % ${random.pick([8, 20, 64])})`,
    `call % ${random.pick([2, 7, 50])} === 0 ? ${random.pick([40, 130, 1000])} : 0`,
    `call < ${Math.max(1, calls >> 1)} ? ${random.pick([0, 1, 3])} : ${random.pick([12, 70, 300])}`,
    `call < ${Math.max(1, calls >> 1)} ? ${random.pick([30, 200])} : ${random.pick([0, 1, 2])}`,
    `(Math.imul(call + 1, 2654435761) >>> 0) % ${random.pick([4, 11, 70])}`,
    `call === ${random.below(calls)} ? ${random.pick([5000, 20000])} : 2`,
  ];

  // Each way fills `list` with `count` elements; `item(i)` makes one.
  const fills = [
    "for (let i = 0; i < count; i++) list.push(item(i));",
    "for (let i = 0; i < count; i++) list[i] = item(i);",
    "for (let i = 0; i < count; i++) list[list.length] = item(i);",
    "for (let i = 0; i + 1 < count; i += 2) list.push(item(i), item(i + 1));",
    "for (let i = 0; i < count; i++) list.unshift(item(i));",
    "for (let i = 0; i < count; i++) list.splice(i >> 1, 0, item(i));",
    "for (let i = count - 1; i >= 0; i--) list[i] = item(i);",
    "list.length = count; for (let i = 0; i < count; i++) list[i] = item(i);",
    "for (let i = 0; i < count; i += 2) list[i] = item(i);",
    "{ const more = []; for (let i = 0; i < count; i++) more.push(item(i)); list.push(...more); }",
    `for (let i = 0; i < count; i++) Array.prototype.push.call(list, item(i));`,
    `for (let i = 0; i < count; i++) add(list, item(i));`,
    `for (let i = 0; i < count; i++) pass(list).push(item(i));`,
    `for (let i = 0; i < count; i++) (list${cast})[pass(String(i))] = item(i);`,
  ];

  const afterwards = [
    "",
    "",
    "while (list.length > 2) list.pop();",
    "if (list.length > 1) list.shift();",
    "list.length = 0; for (let i = 0; i < (count >> 1) + 1; i++) list.push(item(i));",
    "list.length = list.length >> 1;",
    "list.reverse();",
    "list.splice(1, 2);",
    "if (list.length > 3) delete list[1];",
    `Object.freeze(list); try { list.push(item(0)); } catch (error) { failures++; }`,
    `Object.seal(list); try { list.push(item(0)); } catch (error) { failures++; } if (list.length > 0) list[0] = item(9);`,
    `Object.preventExtensions(list); try { list[list.length] = item(0); } catch (error) { failures++; }`,
    `if (call % 64 === 0) Object.defineProperty(list, "0", { value: item(5), writable: false, configurable: true, enumerable: true });`,
    `if (call % 97 === 0) list[list.length + ${random.pick([1, 8, 2000, 70000])}] = item(1);`,
    `(list${cast}).extra = call;`,
    "list.fill(item(3), 1);",
    "list.copyWithin(0, 1);",
    "list = list.concat(list.slice(0, 2));",
    "list = list.filter((_, i) => i % 3 !== 1);",
    "list = list.map((value, i) => (i % 2 === 0 ? value : item(i)));",
  ];

  const makers: string[] = [];
  const loops: string[] = [];
  const count = random.between(2, 5);
  for (let m = 0; m < count; m++) {
    const kind = random.pick(kinds);
    const calls = random.pick([1, 3, 40, 300, 1200, 3000]);
    const listType = `${kind.type.includes("[") || kind.type.includes(" ") ? `(${kind.type})` : kind.type}[]`;
    const fill = random.pick(fills);
    const after = random.pick(afterwards);
    const schedule = random.pick(schedules(calls));
    const item = `const item = (i${as("number")})${as(kind.type)} => ${kind.value("i")};`;
    const head = `  const half = ${Math.max(1, calls >> 1)};\n  const count = ${schedule};\n  ${item}`;
    const place = random.below(7);
    let text: string;
    if (place === 0) {
      text = `function make${m}(call${as("number")}, seed${as("number")})${as(listType)} {
${head}
  let list${as(listType)} = [];
  ${fill}
  ${after}
  return list;
}`;
    } else if (place === 1) {
      text = `function make${m}(call${as("number")}, seed${as("number")})${as(listType)} {
${head}
  const holder${as(`{ id: number; items: ${listType}; next: null }`)} = { id: call, items: [], next: null };
  let list = holder.items;
  ${fill}
  ${after}
  holder.items = list;
  return holder.items;
}`;
    } else if (place === 2) {
      text = `class Holder${m} {
  before = 1;
  items${as(listType)} = [];
  after = "a";
}
function make${m}(call${as("number")}, seed${as("number")})${as(listType)} {
${head}
  const holder = new Holder${m}();
  let list = holder.items;
  ${fill}
  ${after}
  return list;
}`;
    } else if (place === 3) {
      text = `function fill${m}(call${as("number")}, seed${as("number")}, list${as(listType)} = [])${as(listType)} {
${head}
  ${fill}
  ${after}
  return list;
}
function make${m}(call${as("number")}, seed${as("number")})${as(listType)} {
  return call % ${random.pick([2, 5, 100])} === 1 ? fill${m}(call, seed, fill${m}(call, seed + 1)) : fill${m}(call, seed);
}`;
    } else if (place === 4) {
      text = `function make${m}(call${as("number")}, seed${as("number")})${as(listType)} {
${head}
  const rows${as(`${listType}[]`)} = [[], [], []];
  let list = rows[call % 3];
  ${fill}
  ${after}
  rows[(call + 1) % 3].push(item(7));
  return list.concat(rows[(call + 1) % 3], rows[(call + 2) % 3]);
}`;
    } else if (place === 5) {
      text = `function make${m}(call${as("number")}, seed${as("number")})${as(listType)} {
${head}
  let list${as(listType)} = call % ${random.pick([2, 3, 50])} === 0 ? [] : [item(0)];
  const other${as(listType)} = [];
  ${fill}
  ${after}
  for (let i = 0; i < list.length && i < 6; i++) if (i in list) other.push(list[i]);
  return call % 2 === 0 ? list : other;
}`;
    } else {
      text = `const make${m} = (() => {
  const fresh = ()${as(listType)} => [];
  return (call${as("number")}, seed${as("number")})${as(listType)} => {
${head}
    let list = fresh();
    ${fill}
    ${after}
    return list;
  };
})();`;
    }
    makers.push(`// ${kind.name}\n${text}`);
    const collect = random.weighted([
      [3, ""],
      [2, `    if (call % ${random.pick([7, 64, 500])} === ${random.below(7)}) Bun.gc(true);\n`],
      [1, `    if (call % ${random.pick([16, 128])} === 3) Bun.gc(false);\n`],
      [2, `    if (call % ${random.pick([3, 10])} === 0) churn();\n`],
    ]);
    loops.push(`{
  let sum = 0;
  for (let call = 0; call < ${calls}; call++) {
    let list${as("unknown[]")};
    try {
      list = make${m}(call, call & 15);
    } catch (error) {
      failures++;
      list = [${typed ? "(error as Error)" : "error"}.constructor.name];
    }
    sum = (sum * 31 + digest(list)) | 0;
    if (call % ${random.pick([1, 5, 37])} === 0) kept[call % kept.length] = list;
${collect}    if (call === 0 || call === ${calls - 1} || call % ${random.pick([100, 411, 1000])} === 99) console.log("${m}", call, list.length, sum);
  }
  let late = 0;
  for (const list of kept) if (list) late = (late * 31 + digest(list)) | 0;
  console.log("${m} kept", late, failures);
}`);
  }

  return `${typed ? "type Point = { x: number; y: number };\n" : ""}const pass = new Function("value", "return value")${typed ? " as <T>(value: T) => T" : ""};
let failures = 0;
const kept${as("(unknown[] | undefined)[]")} = new Array(${random.pick([4, 32, 256])}).fill(undefined);
function add${typed ? "<T>" : ""}(list${as("T[]")}, value${as("T")})${as("void")} {
  list.push(value);
}
function churn()${as("number")} {
  let total = 0;
  for (let i = 0; i < 400; i++) total += [i, i + 1, { i }, "c" + i].length;
  return total;
}
function digest(list${as("unknown[]")})${as("number")} {
  let sum = list.length * 31;
  for (let i = 0; i < list.length && i < 300; i++) {
    if (!(i in list)) {
      sum = (sum * 33 + 5) | 0;
      continue;
    }
    const value${as("any")} = list[i];
    const part =
      typeof value === "number"
        ? Math.round(value * 4)
        : typeof value === "string"
          ? value.length * 7 + value.charCodeAt(value.length - 1)
          : value === null || value === undefined
            ? 3
            : Array.isArray(value)
              ? value.length + 11
              : value.x * 5 + value.y;
    sum = (sum * 33 + part) | 0;
  }
  return (sum + Object.keys(list).length + (Object.isFrozen(list) ? 1000 : 0) + (Object.isExtensible(list) ? 0 : 500)) | 0;
}

${makers.join("\n\n")}

${loops.join("\n")}
`;
}
