const names: any[] = JSON.parse(
  '["at","concat","entries","every","fill","filter","find","findLast","findLastIndex","flat","flatMap","includes","indexOf","join","keys","lastIndexOf","map","reduce","reverse","slice","some","sort","toReversed","toSorted","toSpliced","toString","toLocaleString","values","with","hasOwnProperty","valueOf","isPrototypeOf","propertyIsEnumerable","length","0","1","-1","2","absent"]',
);
function show(value: unknown): string {
  if (typeof value === "function") return "function";
  if (value !== null && typeof value === "object") {
    if (Array.isArray(value)) return "[" + value.map(show).join(",") + "]";
    if (typeof (value as any).next === "function")
      return "steps:" + [...(value as Iterable<unknown>)].map(show).join("|");
    return "object";
  }
  return String(value);
}
const operands: Record<string, unknown[]> = {
  at: [1],
  concat: [[9]],
  every: [(n: number) => n > 0],
  fill: [7, 2],
  filter: [(n: number) => n > 1],
  find: [(n: number) => n > 1],
  findLast: [(n: number) => n > 1],
  findLastIndex: [(n: number) => n > 1],
  flatMap: [(n: number) => [n, n]],
  includes: [NaN],
  indexOf: [2],
  join: ["-"],
  lastIndexOf: [2],
  map: [(n: number) => n * 2],
  reduce: [(sum: number, n: number) => sum + n, 0],
  slice: [1],
  some: [(n: number) => n > 2],
  sort: [(a: number, b: number) => b - a],
  toSorted: [(a: number, b: number) => b - a],
  toSpliced: [0, 1],
  with: [0, 5],
  hasOwnProperty: ["0"],
  isPrototypeOf: [{}],
  propertyIsEnumerable: ["length"],
};
for (const name of names) {
  const list = [3, 1, 2];
  const found = (list as any)[name];
  console.log(
    name,
    typeof found,
    typeof found === "function" ? show(found.apply(list, operands[name] ?? [])) : show(found),
  );
}
