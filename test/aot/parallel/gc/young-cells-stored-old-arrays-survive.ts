// An array that has lived through a collection gets a young object: by a store to an element, by push, by a store at its length, by the same through `any`. Nothing else holds the object. Young collections follow, and every object is still what it was. Short arrays, which are remembered whole, and arrays so long that only the stored cells are noted; more owners at once than one segment of the collector's list holds
import { edenGC } from "bun:jsc";

interface Item { id: number; text: string }
const collectAll = () => Bun.gc(true);
const lines: string[] = [];
let sink = 0;
function churn(rounds: number): void {
  for (let round = 0; round < rounds; round++) {
    const scratch: { a: number; b: string; c: number[] }[] = [];
    for (let i = 0; i < 3000; i++) scratch.push({ a: i, b: "s" + i, c: [i, i + 1, i + 2] });
    sink += scratch[round % scratch.length].c[1];
  }
}
const first: Item = { id: -1, text: "first" };
function makeOwners(count: number, length: number): Item[][] {
  const owners: Item[][] = [];
  for (let i = 0; i < count; i++) {
    const owner: Item[] = [];
    for (let k = 0; k < length; k++) owner.push(first);
    // Room behind the last element, so that a push stores and does not move the elements.
    owner.push(first); owner.push(first); owner.pop(); owner.pop();
    owners.push(owner);
  }
  return owners;
}
function storeElement(owners: Item[][], round: number): void { for (let i = 0; i < owners.length; i++) owners[i][round % owners[i].length] = { id: i, text: "e" + round }; }
function pushElement(owners: Item[][], round: number): void { for (let i = 0; i < owners.length; i++) owners[i].push({ id: i, text: "p" + round }); }
function storeAtLength(owners: Item[][], round: number): void { for (let i = 0; i < owners.length; i++) { const owner = owners[i]; owner[owner.length] = { id: i, text: "l" + round }; } }
function storeThroughAny(owners: any, round: number): void { for (let i = 0; i < owners.length; i++) { owners[i][0] = { id: i, text: "a" + round }; owners[i].push({ id: i, text: "q" + round }); } }
function storeTwo(owners: Item[][], round: number): void { for (let i = 0; i < owners.length; i++) owners[i].push({ id: i, text: "t" + round }, { id: i, text: "u" + round }); }
// A number, undefined and an old object need no note, and a young one behind them does.
function storeMixed(owners: unknown[][], round: number): void { for (let i = 0; i < owners.length; i++) { const owner = owners[i]; owner[0] = round; owner[1] = undefined; owner[2] = first; owner[3] = { id: i, text: "m" + round }; } }

function digest(owners: unknown[][]): string {
  let sum = 0, items = 0;
  for (let i = 0; i < owners.length; i++) {
    const owner = owners[i];
    for (let k = 0; k < owner.length; k++) {
      const item = owner[k] as Item | number | undefined;
      if (typeof item !== "object") { sum = (sum * 7 + (item === undefined ? 1 : item)) | 0; continue; }
      if (item !== first && item.id !== i) return "owner " + i + " holds " + JSON.stringify(item) + " at " + k;
      for (let c = 0; c < item.text.length; c++) sum = (sum * 31 + item.text.charCodeAt(c)) | 0;
      items++;
    }
  }
  return items + " " + sum;
}

const ways: [string, (owners: any, round: number) => void][] = [["element", storeElement], ["push", pushElement], ["at length", storeAtLength], ["any", storeThroughAny], ["two", storeTwo], ["mixed", storeMixed]];
for (const [count, length] of [[1, 4], [40, 4], [1500, 4], [1500, 1], [30, 1000], [6, 1030], [3, 5000]]) {
  for (const [title, store] of ways) {
    const owners = makeOwners(count, Math.max(length, title === "mixed" ? 4 : 1));
    collectAll();
    for (let round = 0; round < 6; round++) {
      store(owners, round);
      if (round % 3 === 0) edenGC(); else if (round % 3 === 1) churn(3); else collectAll();
      churn(1);
    }
    lines.push(count + " x " + length + " " + title + ": " + digest(owners));
  }
}
console.log(lines.join("\n"));
