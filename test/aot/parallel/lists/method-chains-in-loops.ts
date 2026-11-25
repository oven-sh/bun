// In a loop, a chain of methods of lists is walked as a whole behind the test of its first list, so that each further link knows the list it is called on.
// STATISTIC: MethodChainsKeptInBranches >= 8
const lists: { [name: string]: number[] } = JSON.parse('{"whole":[1,2,3,4,5,6,7,8,9],"fractions":[0.5,1.5,-2.25,4],"one":[3],"none":[],"beyond":[1,4294967296,9007199254740991]}');
const turns: number = JSON.parse("3");
const holes: number[] = [1, 2, 3, 4, 5];
delete holes[2];
lists.holes = holes;
class Own extends Array<number> {}
lists.own = Own.from([1, 2, 3, 4]);
const withOwnMap: any = [1, 2, 3, 4];
lists.withOwnFilter = withOwnMap;
withOwnMap.filter = function (this: number[]) {
  return [this.length, 100];
};
function half(value: number): number {
  return value / 2;
}
function isKept(value: number): boolean {
  return value % 3 !== 0;
}
const log: string[] = [];
function show(value: unknown): string {
  return Array.isArray(value) ? value.constructor.name + "[" + Array.from(value, show).join() + "]" : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}
function filterMapReduce(list: number[]): void {
  for (let turn = 0; turn < turns; turn++) log.push(show(list.filter(n => n % 3 !== 0).map(n => n * 2 + turn).reduce((sum, n) => sum + (n & 1023), 0)));
}
function mapFilter(list: number[]): void {
  for (let turn = 0; turn < turns; turn++) log.push(show(list.map(n => n * 2 + turn).filter(n => n % 4 !== 0)));
}
function byName(list: number[]): void {
  for (let turn = 0; turn < turns; turn++) log.push(show(list.filter(isKept).map(half)));
}
function overRecords(list: number[]): void {
  for (let turn = 0; turn < turns; turn++) log.push(show(list.map(n => ({ n, turn })).filter(made => made.n > turn).map(made => made.n - made.turn)));
}
function filterSome(list: number[]): void {
  for (let turn = 0; turn < turns; turn++) log.push(show(list.filter(n => n > turn).some(n => n % 2 === 0)));
}
function overTexts(list: number[]): void {
  for (let turn = 0; turn < turns; turn++) log.push(show(list.map(n => "t" + n).filter(text => text.length > 1).every(text => text.startsWith("t"))));
}
function filterFind(list: number[]): void {
  for (let turn = 0; turn < turns; turn++) log.push(show(list.filter(n => n > turn).find(n => n % 2 === 1)));
}
function overPairs(list: number[]): void {
  for (let turn = 0; turn < turns; turn++) log.push(show(list.map(n => [n, turn]).map(pair => pair[0] + pair[1]).findIndex(n => n > 4)));
}
function named(list: number[]): void {
  for (let turn = 0; turn < turns; turn++) {
    const kept = list.filter(n => n !== turn);
    const made = kept.map(n => n + 0.5);
    log.push(show(kept), show(made), show(made.reduce((sum, n) => sum + n, 0)));
  }
}
function behindReduce(list: number[]): void {
  for (let turn = 0; turn < turns; turn++) {
    log.push(show(list.reduce((built, n) => (built.push(n * turn), built), [] as number[]).map(n => n + 1)));
    log.push(show(list.reduce((found: any, n) => ({ n, map: (by: (n: number) => number) => by(n) + 1000 }), { map: () => -1 }).map((n: number) => n * 2)));
  }
}
for (const name of Object.keys(lists)) {
  log.push(name);
  for (const run of [filterMapReduce, mapFilter, byName, overRecords, filterSome, overTexts, filterFind, overPairs, named, behindReduce]) run(lists[name]);
}
// A callback of a later link throws, and one of an earlier link changes the list that it goes over.
for (let turn = 0; turn < turns + 1; turn++) {
  const list = [1, 2, 3, 4, 5, 6];
  try {
    log.push(
      show(
        list
          .filter((n, place, whole) => {
            if (place === turn) whole.push(n + 100);
            if (place === turn + 1) whole.length = 5;
            return n % 2 === turn % 2;
          })
          .map((n, place) => {
            if (turn === 3 && place === 1) throw new RangeError("at " + n);
            return n * 10;
          }),
      ),
    );
  } catch (error) {
    log.push(String(error));
  }
  log.push(show(list));
}
// What a link gives is named again behind the chain, or the chain stands in an argument of another.
let carried: number[] = [1, 2, 3];
for (let turn = 0; turn < turns + 2; turn++) {
  const before = carried;
  carried = carried.filter(n => n !== turn).map(n => n + before.length);
  log.push(show(carried.concat(before.map(n => n - 1).filter(n => n > 0))));
  log.push(show([1, 2, 3].map(n => carried.filter(m => m > n).map(m => m * n).length)));
}
console.log(log.join("\n"));
