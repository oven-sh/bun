// A .ts file without import or export is a script unless the project says `moduleDetection: force`: what it declares is global, as for tsc and `bun check`, also where nothing imports it.
const pair: Pair = [
  { x: 1, y: 2 },
  { x: 3, y: 4 },
];
function sum(point: Point): number {
  return point.x + point.y;
}
console.log(sum(pair[0]), sum(pair[1]), typeof BUILD_LABEL);
export {};
