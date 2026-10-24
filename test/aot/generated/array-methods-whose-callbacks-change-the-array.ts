// filter, map, slice and what follows them (reduce, join, some, find, flatMap, a length ..), alone and in chains, in functions that run often. At the second element
// a callback changes the array that is walked: it gets shorter, longer, other kinds of elements, holes, an accessor, another prototype; it is frozen, sorted, shifted.
// Each function prints what it answers and what is left of the array.

/** What a callback does to the array. `a` is the array; in TypeScript its type is number[]. */
export const changes: Record<string, string> = {
  "nothing": ``,
  "shortens it": `a.length = 2;`,
  "empties it": `a.length = 0;`,
  "makes it much longer": `for (let k = 0; k < 3000; k++) a.push(k);`,
  "empties it and fills it with strings": `a.length = 0; for (let k = 0; k < 8; k++) (a as unknown[]).push("s" + k);`,
  "empties it and fills it with objects": `a.length = 0; for (let k = 0; k < 8; k++) (a as unknown[]).push({ valueOf() { return k; } });`,
  "stores a string": `(a as unknown[])[3] = "7";`,
  "stores a fraction": `a[3] = 0.5;`,
  "stores NaN": `a[3] = NaN;`,
  "stores undefined": `(a as unknown[])[3] = undefined;`,
  "deletes an element": `delete a[3];`,
  "stores far behind the end": `a[100000] = 7;`,
  "freezes it": `Object.freeze(a);`,
  "defines an accessor": `Object.defineProperty(a, 3, { get() { return 70; }, configurable: true });`,
  "gives it a prototype with an element": `delete a[3]; Object.setPrototypeOf(a, Object.assign(Object.create(Array.prototype), { 3: 33 }));`,
  "shifts it": `a.shift();`,
  "puts two in front": `a.unshift(8, 9);`,
  "cuts two out": `a.splice(1, 2);`,
  "reverses it": `a.reverse();`,
  "sorts it": `a.sort((x, y) => y - x);`,
  "fills it": `a.fill(9);`,
  "gives it a species": `(a as { constructor: unknown }).constructor = { [Symbol.species]: function () { return { length: 0 }; } };`,
  "throws": `throw new RangeError("stop");`,
};

/** The body of a function of `a` and `change`. `FIRST` and `LATER` stand where the callback of the first and of a later method changes the array. */
const forms: Record<string, string> = {
  filter: `return a.filter((v, i) => { FIRST return v > 1; });`,
  map: `return a.map((v, i) => { FIRST return v * 2; });`,
  mapToFractions: `return a.map((v, i) => { FIRST return v / 4; });`,
  mapToNaN: `return a.map((v, i) => { FIRST return i === 2 ? NaN : i === 3 ? -0 : v; });`,
  mapToTexts: `return a.map((v, i) => { FIRST return "t" + v; });`,
  filterMap: `return a.filter((v, i) => { FIRST return v > 1; }).map((v, i) => { LATER return v * 2; });`,
  mapFilter: `return a.map((v, i) => { FIRST return v * 2; }).filter((v, i) => { LATER return v > 2; });`,
  filterMapReduce: `return a.filter((v, i) => { FIRST return v > 1; }).map(v => v * 2).reduce((t, v, i) => { LATER return t + v; }, 0);`,
  mapReduceWithoutAStart: `return a.map((v, i) => { FIRST return v + 1; }).reduce((t, v) => t + v);`,
  sliceMap: `return a.slice(1).map((v, i) => { LATER return v * 2; });`,
  sliceFilter: `return a.slice(1, -1).filter((v, i) => { LATER return v > 2; });`,
  filterLength: `return a.filter((v, i) => { FIRST return v > 1; }).length;`,
  mapJoin: `return a.map((v, i) => { FIRST return v * 2; }).join("-");`,
  filterSome: `return a.filter((v, i) => { FIRST return v > 1; }).some(v => v > 4);`,
  filterEvery: `return a.filter((v, i) => { FIRST return v > 1; }).every(v => v < 100);`,
  filterFind: `return a.filter((v, i) => { FIRST return v > 1; }).find(v => v > 3);`,
  mapFindIndex: `return a.map((v, i) => { FIRST return v * 2; }).findIndex(v => v > 6);`,
  mapForEach: `let t = 0; a.map((v, i) => { FIRST return v * 2; }).forEach((v, i) => { LATER t += v; }); return t;`,
  filterFlatMap: `return a.filter((v, i) => { FIRST return v > 1; }).flatMap((v, i) => { LATER return [v, v + 0.5]; });`,
  threeLinks: `return a.filter((v, i) => { FIRST return v > 0; }).map(v => v + 1).filter(v => v !== 4).map((v, i) => { LATER return v * 3; });`,
};

const sources: Record<string, string> = {
  integers: `[1, 2, 3, 4, 5, 6]`,
  fractions: `[1.5, 2.5, 3.5, 4.5, 5.5, 6.5]`,
  holes: `[1, 2, , 4, , 6]`,
};

export const places = ["first", "later"] as const;

export function program(change: string, place: (typeof places)[number], isTypeScript: boolean) {
  const here = `if (i === 1) change(a);`;
  const chosen = Object.entries(forms).filter(([, body]) => body.includes(place === "first" ? "FIRST" : "LATER"));
  const text = `function attempt(f: () => unknown): unknown { try { return f(); } catch (e) { return "threw " + (e as Error).constructor.name; } }
type Change = (a: number[]) => void;
const show = (value: unknown): string => Array.isArray(value) ? "[" + value.length + ": " + Array.from(value, v => Object.is(v, -0) ? "-0" : String(v)).join() + "]" : String(value);
${chosen.map(([name, body]) => `function ${name}(a: number[], change: Change): unknown { ${body.replace("FIRST", place === "first" ? here : "").replace("LATER", place === "later" ? here : "")} }`).join("\n")}
function all(make: () => number[], change: Change): string {
  const lines: string[] = [];
${chosen.map(([name]) => `  { const a = make(); lines.push("${name} " + show(attempt(() => ${name}(a, change))) + " of " + show(a)); }`).join("\n")}
  return lines.join("\\n");
}
const quiet: Change = a => {};
const loud: Change = a => { ${changes[change]} };
${Object.entries(sources)
  .map(
    ([name, literal]) => `{
  const make = (): number[] => ${literal} as number[];
  let before = "";
  for (let turn = 0; turn < 60; turn++) before = all(make, quiet);
  console.log("${name}\\n" + before + "\\n--\\n" + all(make, loud) + "\\n--\\n" + (all(make, quiet) === before));
}`,
  )
  .join("\n")}
`;
  return isTypeScript ? { file: "main.ts", text } : { file: "main.js", text: new Bun.Transpiler({ loader: "ts" }).transformSync(text) };
}
