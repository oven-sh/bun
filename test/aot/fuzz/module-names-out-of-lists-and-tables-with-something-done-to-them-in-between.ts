// Very small CommonJS and TypeScript programs. A list or a table of the file holds the names of two of the five files in lib/, one to three things are done to it, and then a loader is
// called with "./lib/" + name + the extension for each name that it holds.
//
//   done in between   about half of the things change what the list or table holds, on every road by which it reaches code: a store, a member that changes a list, another name for it, a
//                     function that gets it, the function of a walk (its third parameter, `arguments`, a rest parameter, `this`), a pattern or the head of a loop that stores, a method
//                     of its own that an operator or a call runs. The others only ask it, or change a copy
//   read by           `for..of`, `forEach`, an index, a key, `Object.values`
//   loaded by         `require`, `import()`
//
// Whatever is stored is the name of a file in lib/, so plain Bun loads a file each time.
import type { Random } from "./random";

const fileNames = ["a", "b", "c", "d", "e"];

type Thing = (holder: string, place: string, name: string) => string;

const doneToLists: Thing[] = [
  (h, k, v) => `${h}[${k}] = ${v};`,
  (h, k, v) => `${h}.forEach((name, index, list) => { list[${k}] = ${v}; });`,
  (h, k, v) => `${h}.map((name, index, list) => (list[${k}] = ${v}));`,
  (h, k, v) => `${h}.filter((name, index, list) => (list[${k}] = ${v}));`,
  (h, k, v) => `${h}.find((name, index, list) => { list[${k}] = ${v}; });`,
  (h, k, v) => `${h}.findLastIndex((name, index, list) => { list[${k}] = ${v}; });`,
  (h, k, v) => `${h}.some((name, index, list) => { list[${k}] = ${v}; });`,
  (h, k, v) => `${h}.every((name, index, list) => (list[${k}] = ${v}));`,
  (h, k, v) => `${h}.reduce((sum, name, index, list) => { list[${k}] = ${v}; return sum; }, 0);`,
  (h, k, v) => `${h}.flatMap((name, index, list) => { list[${k}] = ${v}; return []; });`,
  (h, k, v) => `${h}.forEach(function () { arguments[2][${k}] = ${v}; });`,
  (h, k, v) => `${h}.forEach((...given) => { given[2][${k}] = ${v}; });`,
  (h, k, v) => `${h}.forEach(function () { this[${k}] = ${v}; }, ${h});`,
  (h, k, v) => `${h}.forEach((name, index, list) => { const same = list; same[${k}] = ${v}; });`,
  (h, k, v) => `${h}.forEach((name, index, list) => { list.forEach((inner, at, again) => { again[${k}] = ${v}; }); });`,
  (h, k, v) => `${h}.forEach((name, index, list) => { store(list, ${k}, ${v}); });`,
  (h, k, v) => `${h}.forEach(storeInThird(${k}, ${v}));`,
  (h, k, v) => `store(${h}, ${k}, ${v});`,
  (h, k, v) => `{ const same = ${h}; same[${k}] = ${v}; }`,
  (h, k, v) => `{ let same; same = ${h}; same[${k}] = ${v}; }`,
  (h, k, v) => `${h}.splice(${k}, 1, ${v});`,
  (h, k, v) => `${h}.fill(${v}, ${k}, ${k} + 1);`,
  h => `${h}.reverse();`,
  h => `${h}.sort();`,
  h => `${h}.copyWithin(0, 1);`,
  (h, _, v) => `${h}.push(${v});`,
  (h, _, v) => `${h}.unshift(${v});`,
  (h, _, v) => `${h}.pop(); ${h}.push(${v});`,
  (h, _, v) => `${h}.length = 1; ${h}.push(${v});`,
  (h, k, v) => `Object.assign(${h}, { [${k}]: ${v} });`,
  (h, k, v) => `Reflect.set(${h}, ${k}, ${v});`,
  (h, k, v) => `[${h}[${k}]] = [${v}];`,
  (h, k, v) => `({ x: ${h}[${k}] } = { x: ${v} });`,
  (h, k, v) => `for (${h}[${k}] of [${v}]);`,
  (h, k, v) => `for (${h}[${k}] in { [${v}]: 1 });`,
  (h, k, v) => `${h}[${k}] &&= ${v};`,
  (h, k, v) => `${h} instanceof { [Symbol.hasInstance](list) { list[${k}] = ${v}; return true; } };`,
  (h, k, v) => `((strings, list) => { list[${k}] = ${v}; })\`\${${h}}\`;`,
  (h, k, v) => `(store({}, 0, 0), ${h})[${k}] = ${v};`,
  (h, k, v) => `(${h} || [])[${k}] = ${v};`,
  (h, k, v) => `new Proxy(${h}, {})[${k}] = ${v};`,
  (h, k, v) => `Array.prototype.splice.call(${h}, ${k}, 1, ${v});`,
  (h, k, v) => `${h}.join({ toString() { ${h}[${k}] = ${v}; return ","; } });`,
  (h, _, v) => `console.log(${h}.includes(${v}), ${h}.indexOf(${v}), ${h}.join(), ${h}.length);`,
  (h, k) => `console.log(${h}[${k}], typeof ${h}, \`\${${h}}\`);`,
  h => `${h}.forEach((name, index) => { console.log(index, name); });`,
  h => `console.log(${h}.map(name => name + name).join(), ${h}.filter(name => name > "b").length);`,
  h => `${h}.forEach((name, index, list) => { console.log(list.includes(name), list[index] === name, list.join()); });`,
  h => `console.log(${h}.map((name, index, list) => name + list.length).join());`,
  (h, k, v) => `{ const copy = [...${h}]; copy[${k}] = ${v}; }`,
  (h, k, v) => `${h}.slice().forEach((name, index, list) => { list[${k}] = ${v}; });`,
  (h, _, v) => `console.log(${h}.concat([${v}]).length, JSON.stringify(${h}));`,
];

const doneToTables: Thing[] = [
  (h, k, v) => `${h}.${k} = ${v};`,
  (h, k, v) => `${h}["${k}"] = ${v};`,
  (h, k, v) => `delete ${h}.${k}; ${h}.${k} = ${v};`,
  (h, k, v) => `Object.assign(${h}, { ${k}: ${v} });`,
  (h, k, v) => `Object.defineProperty(${h}, "${k}", { value: ${v} });`,
  (h, k, v) => `Reflect.set(${h}, "${k}", ${v});`,
  (h, k, v) => `for (${h}.${k} of [${v}]);`,
  (h, k, v) => `({ x: ${h}.${k} } = { x: ${v} });`,
  (h, k, v) => `store(${h}, "${k}", ${v});`,
  (h, k, v) => `{ const same = ${h}; same.${k} = ${v}; }`,
  (h, k, v) => `Object.keys(${h}).forEach(key => { if (key === "${k}") ${h}[key] = ${v}; });`,
  (h, k, v) => `${h} instanceof { [Symbol.hasInstance](table) { table.${k} = ${v}; return true; } };`,
  (h, k, v) => `(${h} ?? {}).${k} = ${v};`,
  h => `${h}.change();`,
  h => `\`\${${h}}\`;`,
  h => `${h} + "";`,
  h => `${h} < 2;`,
  h => `({})[${h}];`,
  h => `${h} != "other";`,
  h => `${h}.asked;`,
  (h, k) => `console.log(${h}.${k}, typeof ${h}, "${k}" in ${h});`,
  h => `console.log(Object.keys(${h}).length, Object.values(${h}).length);`,
  (h, k, v) => `{ const copy = { ...${h} }; copy.${k} = ${v}; }`,
  (h, _, v) => `Object.values(${h}).forEach((name, index, list) => { list[0] = ${v}; });`,
];

export function generate(random: Random): { file: string; text: string; files: Record<string, string> } {
  const isTyped = random.chance(0.25);
  const extension = isTyped ? "ts" : "cjs";
  const files: Record<string, string> = {};
  for (const name of fileNames)
    files[`lib/${name}.${extension}`] = isTyped
      ? `export const who: string = "lib/${name}";\n`
      : `exports.who = "lib/${name}";\n`;
  const load = (name: string) =>
    isTyped
      ? `console.log((await import("./lib/" + ${name} + ".ts")).who);`
      : `console.log(require("./lib/" + ${name} + ".cjs").who);`;

  const isTable = random.chance(0.35);
  const [first, second] = random.sample(fileNames, 2);
  const text = () => JSON.stringify(random.pick(fileNames));
  const keyword = random.pick(["const", "const", "let", "var"]);
  const any = isTyped ? ": any" : "";
  const lines = [
    `function store(holder${any}, place${any}, name${any}) { holder[place] = name; }`,
    `function storeInThird(place${any}, name${any}) { return (...given${isTyped ? ": any[]" : ""}) => { given[2][place] = name; }; }`,
  ];
  if (isTable) {
    const own = [
      `change() { this.second = ${text()}; }`,
      `toString() { this.first = ${text()}; return "text"; }`,
      `valueOf() { this.second = ${text()}; return 1; }`,
      `get asked() { this.first = ${text()}; return 1; }`,
    ];
    const things = Array.from({ length: random.between(1, 3) }, () => random.pick(doneToTables));
    const written = things.map(thing => thing("table", random.pick(["first", "second"]), text()));
    const needed = own.filter((_, index) => {
      const uses = [/\.change\(/, /`\$\{table\}`|table \+ ""|\[table\]|table != /, /table < 2/, /\.asked/][index];
      return written.some(line => uses.test(line)) || random.chance(0.1);
    });
    lines.push(
      `${keyword} table${any} = { ${[`first: "${first}"`, `second: "${second}"`, ...needed].join(", ")} };`,
      ...written,
    );
    const reader = needed.length ? "keys" : random.pick(["keys", "members", "values"]);
    if (reader === "keys") lines.push(`for (const key of ["first", "second"]) ${load("table[key]")}`);
    else if (reader === "members") lines.push(load("table.first"), load("table.second"));
    else lines.push(`for (const name of Object.values(table)) ${load("name")}`);
  } else {
    const things = Array.from({ length: random.between(1, 3) }, () => random.pick(doneToLists));
    lines.push(`${keyword} names${any} = ["${first}", "${second}"];`);
    for (const thing of things) lines.push(thing("names", String(random.below(2)), text()));
    const reader = random.pick(isTyped ? ["for", "for", "index"] : ["for", "for", "forEach", "index"]);
    if (reader === "for") lines.push(`for (const name of names) ${load("name")}`);
    else if (reader === "forEach") lines.push(`names.forEach(name => { ${load("name")} });`);
    else lines.push(load("names[0]"), load("names[names.length - 1]"));
  }
  return { file: `main.${extension}`, text: lines.join("\n") + "\n", files };
}
