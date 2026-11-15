function half(list: unknown[]): void {
  for (let i = 0; i < list.length; i++) list[i] = 0.5;
}
function scaled(list: unknown[], by: number): void {
  for (let i = 0; i < list.length; i++) list[i] = i * by;
}
function minusZero(list: unknown[]): void {
  for (let i = 0; i < list.length; i++) list[i] = -0;
}
function writtenNaN(list: unknown[]): void {
  for (let i = 0; i < list.length; i++) list[i] = NaN;
}
function counted(list: unknown[]): void {
  for (let i = 0; i < list.length; i++) list[i] = i;
}
function literalOfInt32s(): unknown[] {
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
}
function literalOfFractions(): unknown[] {
  return [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5];
}
function literalOfTexts(): unknown[] {
  return ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"];
}
function mark(value: unknown): string {
  return Object.is(value, -0) ? "-0" : value !== value ? "NaN" : String(value);
}
function show(name: string, list: unknown[]): void {
  console.log(name, Array.from(list, mark).join(","));
  console.log(" ", list.includes(0.5), list.includes(NaN), list.indexOf(0), list.lastIndexOf(2.5), list.concat([1, "x"]).length);
  console.log(" ", Array.from(list.slice().reverse(), mark).join(","), Array.from(list.slice(2, 9).sort(), mark).join(","));
  list.push("behind");
  console.log(" ", list.length, mark(list[list.length - 2]), mark(list[list.length - 1]));
}
const made: Record<string, () => unknown[]> = {
  int32s: () => Array.from({ length: 11 }, (_, i) => i + 1),
  fractions: () => Array.from({ length: 11 }, (_, i) => i + 0.25),
  texts: () => Array.from({ length: 11 }, (_, i) => "t" + i),
  mixed: () => [1, "two", 3.5, null, undefined, {}, 7, 8.5, "nine", 10, 11],
  holesInInt32s: () => { const l: unknown[] = Array.from({ length: 11 }, (_, i) => i); delete l[1]; delete l[9]; return l; },
  holesInFractions: () => { const l: unknown[] = Array.from({ length: 11 }, (_, i) => i + 0.5); delete l[0]; delete l[10]; return l; },
  holesInTexts: () => { const l: unknown[] = Array.from({ length: 11 }, (_, i) => "t" + i); delete l[5]; return l; },
  byLength: () => new Array(11),
  sparse: () => { const l: unknown[] = []; l[2000] = 1; l.length = 11; return l; },
  writtenInt32s: literalOfInt32s,
  writtenFractions: literalOfFractions,
  writtenTexts: literalOfTexts,
  empty: () => [],
  three: () => [1, 2, 3].map(x => x),
};
const stores: Record<string, (list: unknown[]) => void> = {
  half,
  minusZero,
  writtenNaN,
  counted,
  quarters: list => scaled(list, 0.25),
  whole: list => scaled(list, 2),
  downward: list => scaled(list, -1),
  notANumber: list => scaled(list, NaN),
  endless: list => scaled(list, Infinity),
};
for (const store of Object.keys(stores)) {
  for (const name of Object.keys(made)) {
    const list = made[name]!();
    stores[store]!(list);
    show(store + " into " + name, list);
  }
}
console.log(literalOfInt32s().join(), literalOfFractions().join(), literalOfTexts().join());
for (const make of [literalOfInt32s, literalOfFractions, made.texts!]) {
  const frozen = Object.freeze(make());
  let said = "stored";
  try { half(frozen as unknown[]); } catch (error) { said = (error as Error).constructor.name; }
  console.log(said, frozen.join());
}
