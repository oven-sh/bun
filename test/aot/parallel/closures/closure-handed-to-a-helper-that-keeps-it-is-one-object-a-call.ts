// A helper with a written type for its list is copied where it is handed a closure, and the copy has a failing side for what is no list. Whichever side runs, the helper sees one object for each evaluation of the arrow.
const kept: unknown[] = [];
function each(list: number[], visit: (x: number) => void): void {
  kept.push(visit);
  for (let i = 0; i < list.length; i++) visit(list[i]);
}
function inTheBlockOfTheCall(list: number[]): number {
  let total = 0;
  each(list, x => {
    total += x;
  });
  return total;
}
function inFrontOfTheLoop(lists: number[][]): number {
  let total = 0;
  const add = (x: number) => {
    total += x;
  };
  for (let i = 0; i < lists.length; i++) each(lists[i], add);
  return total;
}
function handedOverTwice(list: number[], other: number[]): number {
  let total = 0;
  const add = (x: number) => {
    total += x;
  };
  each(list, add);
  each(other, add);
  return total;
}
const like: any = { length: 2, 0: 7, 1: 8 };
const lists: number[][] = [[1, 2], like, [3], like];
console.log(inTheBlockOfTheCall([1, 2, 3]), inTheBlockOfTheCall(like), new Set(kept).size);
kept.length = 0;
console.log(inFrontOfTheLoop(lists), kept.length, new Set(kept).size);
kept.length = 0;
console.log(handedOverTwice([4], like), handedOverTwice(like, [5]), handedOverTwice(like, like), kept.length, new Set(kept).size);
