// An object that the function has just made lists a number, and the function reads it back: with nothing between, behind stores into other fields, behind a store of undefined, and behind code nobody has seen.
const outside: any = (globalThis as any)[process.argv[2] ?? "Array"];
type Late = { a?: number; flag?: boolean; p1?: number; p2?: number; p3?: number; p4?: number; p5?: number };

function behindOtherStores(c: number, v: number) {
  const o: Late = { a: v, flag: c > 1 };
  if (c & 1) o.p1 = 1;
  o.p1 = 2;
  if (c & 2) o.p2 = 1;
  o.p2 = 2;
  if (c & 4) o.p3 = 1;
  o.p3 = 2;
  if (c & 8) o.p4 = 1;
  o.p4 = 2;
  if (c & 16) o.p5 = 1;
  o.p5 = 2;
  return [o.a, o.flag, o.p1 + o.p2 + o.p3 + o.p4 + o.p5];
}
function undefinedOnOneWay(c: number, v: number) {
  const o: Late = { a: v };
  outside(c);
  if (c & 1) o.a = undefined;
  const read = o.a;
  outside(o);
  return [read, o.a];
}
function readThenUndefined(c: number, v: number) {
  const o: Late = { a: v };
  outside(c);
  const first = o.a;
  if (c & 1) o.a = undefined;
  const second = o.a;
  outside(o);
  return [first, second, o.a];
}
function undefinedListed(c: number, v: number) {
  const o: Late = { a: c & 1 ? undefined : v };
  const read = o.a;
  outside(o);
  return [read, o.a, "a" in o];
}
function changedByOthers(v: number, change: any) {
  const o: Late = { a: v };
  change(o);
  return [o.a, typeof o.a, "a" in o];
}

const changes = [(o: any) => {}, (o: any) => { o.a = "text"; }, (o: any) => { delete o.a; }, (o: any) => { o.a = undefined; }, (o: any) => { Object.defineProperty(o, "a", { get: () => 7 }); }];
const lines: string[] = [];
for (let turn = 0; turn < 200; turn++) {
  const row = [behindOtherStores(turn, turn), undefinedOnOneWay(turn, turn), readThenUndefined(turn, turn), undefinedListed(turn, turn), changedByOthers(turn, changes[turn < 150 ? 0 : turn % 5])];
  if (turn < 2 || turn > 194) lines.push(JSON.stringify(row));
}
console.log(lines.join("\n"));
