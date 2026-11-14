// A chain of methods of lists on a row that changes with the turns of a loop stays behind the one guess at that row, and each further link asks for its own list.
// STATISTIC: MethodChainsKeptInBranches >= 6
const rows: number[][] = JSON.parse("[[1,2,3,4,5,6],[],[7],[0.5,1.5,2],[4294967296,3,-1,-2]]");
const holes: number[] = [1, 2, 3, 4];
delete holes[1];
rows.push(holes);
class Own extends Array<number> {}
rows.push(Own.from([3, 4, 5]));
const withOwnMap: any = [1, 2, 3];
withOwnMap.filter = function (this: number[]) {
  return { map: (by: (n: number) => number) => [by(this.length), 100] };
};
rows.push(withOwnMap);
class Box {
  constructor(
    readonly cells: number[],
    readonly weight: number,
  ) {}
  get heavy(): number[] {
    return this.cells.filter(n => n > this.weight).map(n => n - this.weight);
  }
}
const log: string[] = [];
function show(value: unknown): string {
  return Array.isArray(value) ? value.constructor.name + "[" + Array.from(value, show).join() + "]" : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}
const turns: number = JSON.parse("2");
function attempt(work: () => unknown): void {
  try {
    log.push(show(work()));
  } catch (error) {
    log.push(error instanceof Error ? error.name : String(error));
  }
}
function filterMapReduce(): void {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) for (const row of rows) if (row !== withOwnMap) total += row.filter(n => n % 3 !== 0).map(n => n * 2 + turn).reduce((sum, n) => sum + (n & 1023), 0);
  log.push(show(total));
}
function mapFilter(): void {
  for (let turn = 0; turn < turns; turn++) for (const row of rows) log.push(show(row.map(n => n + turn).filter(n => n % 2 === 0)));
}
function filterMap(): void {
  for (let turn = 0; turn < turns; turn++) for (const row of rows) log.push(show(row.filter(n => n > turn).map(n => n * 10)));
}
function mapSome(): void {
  let count = 0;
  for (let turn = 0; turn < turns; turn++) for (const row of rows) if (row.map(n => n - turn).some(n => n === 2)) count++;
  log.push(show(count));
}
function byPlace(): void {
  for (let place = 0; place < rows.length; place++) log.push(show(rows[place].map((n, at) => n * at).find(n => n > 5)));
}
function boxes(): void {
  const all = rows.map((row, at) => new Box(row, at));
  for (const box of all) attempt(() => box.heavy);
  for (const box of all) log.push(show(box.cells.map(n => n + box.weight).every(n => n > 0)));
}
function grown(): void {
  const list: number[][] = [];
  for (const row of rows) {
    list.push(row === withOwnMap ? [] : row.map(n => n % 4).filter(n => n !== 0));
    list[0].push(list.length);
  }
  log.push(show(list));
}
function notLists(): void {
  const mixed: any[] = JSON.parse('[[1,2,3],null,"text",{"filter":1},[4]]');
  for (const row of mixed) attempt(() => row.filter((n: number) => n > 1).map((n: number) => n + 1));
  for (const row of mixed) {
    try {
      log.push(show(row.filter((n: number) => n > 1).map((n: number) => n + 1)));
    } catch (error) {
      log.push((error as Error).name);
    }
  }
}
for (const run of [filterMapReduce, mapFilter, filterMap, mapSome, byPlace, boxes, grown, notLists]) {
  log.push(run.name);
  run();
}
console.log(log.join("\n"));
