// An array is born with a storage (integers, doubles, anything) that its creator picks from what it knows of the elements at that place; its readers trust what the compiler proves of the
// array. Where the two disagree a boxed 0 is read as a double: NaN. A program is what stands beside the number in its record (a member whose check may fail, or not), the number, the
// creator, the reader, and a late definition under a computed key (or none).
export function programs() {
  const made: { name: string; file: string; text: string }[] = [];
  const besides: Record<string, string> = { takesAList: "r2.size", plainText: '"plain"' };
  const numbers: Record<string, string> = {
    beyondTheEnd: '("\\u00e9t\\u00e9".charCodeAt(3) | 0)', constant: "100", fraction: "1.5", ofAField: "(r2.flag | 0)", fieldAndHalf: "r2.flag + 0.5", floored: "Math.floor(2.5)", minusZero: "-0", notANumber: "NaN",
    aLength: '"12".length', parsed: 'Number("3")', anElement: "r2.tag[0]", listLength: "r2.tag.length", big: "2147483648", shifted: "(r2.flag << 16)",
  };
  const creators: Record<string, (e: string) => string> = {
    one: e => `[${e}]`, two: e => `[${e}, ${e}]`, withFraction: e => `[${e}, 1.5]`, behindInteger: e => `[1, ${e}]`, of: e => `Array.of(${e})`, joined: e => `[${e}].concat([${e}])`, spread: e => `[...[${e}]]`,
    filled: e => `new Array(2).fill(${e})`, from: e => `Array.from({ length: 2 }, () => ${e})`, pushed: e => `(() => { const a: number[] = []; a.push(${e}); return a; })()`, sliced: e => `[${e}].slice()`, mapped: e => `[${e}].map(x => x)`,
  };
  const readers: Record<string, string> = {
    typedLoop: `function total(list: number[]): number { let s = 0; for (let i = 0; i < list.length; i++) s += list[i]; return s; }\nconsole.log(show(total(r9.tag)));`,
    typedForOf: `function total(list: number[]): number { let s = 0; for (const v of list) s += v; return s; }\nconsole.log(show(total(r9.tag)));`,
    typedFirst: `function first(list: number[]): number { return list[0] * 2 + 1; }\nconsole.log(show(first(r9.tag)));`,
    typedStore: `function bump(list: number[]): void { list[0] = list[0] + 1; }\nbump(r9.tag); console.log(r9.tag.map(show).join());`,
    inPlace: `let s = 0; for (let i = 0; i < r9.tag.length; i++) s += r9.tag[i]; console.log(show(s));`,
    reduce: `console.log(show(r9.tag.reduce((a, b) => a + b, 10)));`,
    mapJoin: `console.log(r9.tag.map(item => item * 2).map(show).join());`,
    natives: `console.log(r9.tag.includes(r9.tag[0]), r9.tag.indexOf(r9.tag[0]), show(Math.max(...r9.tag)), JSON.stringify(r9.tag), show(r9.tag.at(-1)!), [...r9.tag].sort().map(show).join(), Array.from(Float64Array.from(r9.tag)).map(show).join());`,
    untypedLoop: `function total(list: any): any { let s = 0; for (let i = 0; i < list.length; i++) s += list[i]; return s; }\nconsole.log(show(total(r9.tag)));`,
    typedClass: `class Sum { constructor(public list: number[]) {} total(): number { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }\nconsole.log(show(new Sum(r9.tag).total()));`,
  };
  const lates: Record<string, string> = { defined: `(r9.tag.map(item => String) + "]");\nArray.from({ length: 1 }, () => {\n  Object.defineProperty(r2, "0~".slice(), { value: (r6.flag << 16) }); });`, nothing: "" };
  for (const [b, beside] of Object.entries(besides)) for (const [m, number] of Object.entries(numbers)) for (const [c, creator] of Object.entries(creators)) for (const [r, reader] of Object.entries(readers)) for (const [l, late] of Object.entries(lates)) {
    made.push({ name: `${b}-${m}-${c}-${r}-${l}`, file: "program.ts", text: `function show(v: number): string { return Object.is(v, -0) ? "-0" : String(v); }
  const r2 = { y: "1.5".repeat(2), size: ([]), flag: (100), tag: [(7)] };
  const r4 = { y: ${beside}, size: (typeof (7)), flag: ${number}, tag: [] };
  const r6 = r4;
  const r9 = { x: (r4.size + r4), tag: ${creator("r4.flag")} };
  ${reader}
  ${late}
  ` });
  }
  return made;
}
