// The array methods have a loop for arrays of doubles, one for other plain arrays, and a call for the rest. Where the declared elements hold no
// number the first is gone as soon as the method stands in its caller: the function that was handed in is copied once.
// IRT= 0 namesOf GetDoubleIndex
// IRT= 1 namesOf GetContiguousIndex
// IRT= 1 halves GetDoubleIndex
declare const console: { log(...values: unknown[]): void };
declare const globalThis: { kept?: unknown };
interface Item { name: string; size: number }
function namesOf(lists: Item[][]): string[] {
  const names: string[] = [];
  for (let i = 0; i < lists.length; i++) names.push(lists[i].map(item => item.name + ":" + item.size).join());
  return names;
}
function halves(lists: number[][]): number {
  let sum = 0;
  for (let i = 0; i < lists.length; i++) sum += lists[i].map(x => x / 2)[0];
  return sum;
}
function textsOf(lists: string[][]): string[] {
  const texts: string[] = [];
  for (let i = 0; i < lists.length; i++) texts.push(lists[i].map(text => "<" + text + ">").join(""), String(lists[i].filter(text => text !== "b").length), String(lists[i].some(text => text === "c")));
  return texts;
}
globalThis.kept = [namesOf, halves, textsOf];
console.log(namesOf([[{ name: "a", size: 1 }, { name: "b", size: 2 }], [], [{ name: "c", size: 3 }]]).join("|"));
console.log(halves([[1.5, 2.5], [3, 4], [0.25]]));
console.log(textsOf([["a", "b"], [], ["c"]]).join("|"));
const holes: string[] = [, "x", , "y"] as string[];
console.log(textsOf([holes, new Array<string>(2), []]).join("|"));
