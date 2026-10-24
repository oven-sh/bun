// `a.push(x)` behind code nobody has seen: the array may have got a `push` of its own, another prototype, an accessor under an index, or nothing at all.
const outside: any = (globalThis as any)[process.argv[2] ?? "Array"];

function pushes(a: number[], x: number, change: any) {
  change(a);
  const pushed = a.push(x);
  return [pushed, a.length, a.indexOf(x)];
}

const changes = [
  (a: any) => {},
  (a: any) => { a.push = () => -1; },
  (a: any) => { Object.setPrototypeOf(a, { push: () => -2, indexOf: () => -3 }); },
  (a: any) => { Object.defineProperty(a, "5", { get: () => 9, set() {}, configurable: true }); },
  (a: any) => { a.extra = 1; },
];
const lines: string[] = [];
for (let turn = 0; turn < 300; turn++) {
  const a = [1, 2, 3];
  outside(a);
  const row = pushes(a, turn, changes[turn < 250 ? 0 : turn % 5]);
  if (turn < 2 || turn > 292) lines.push(JSON.stringify(row));
}
console.log(lines.join("\n"));
