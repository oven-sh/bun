// A typed helper gets a value that its types forbid, through `any`, in the middle of its body. From there on it does what JavaScript does with that value: it calls a method, runs a setter or a trap
// that keeps the helper's argument and writes to it. The caller made the argument and reads it behind the call, so what it believes of the helper has to cover that too.
class Reader {
  total = 0;
  read(point: { x: number; z: number; list: number[] }): void {
    this.total += point.x;
  }
}

let keptPoint: any = null;
const impostor = {
  total: 0,
  read(point: any) {
    keptPoint = point;
    point.x = 40;
    point.list.push(9);
  },
};

let current: any = new Reader();
function currentReader(): Reader {
  return current;
}

let sink = 0;
function spin(rounds: number): void {
  for (let i = 0; i < rounds; i++) sink = (sink * 31 + i) | 0;
}

function visit(point: { x: number; z: number; list: number[] }, rounds: number): void {
  spin(rounds);
  const reader = currentReader();
  reader.read(point);
}

function callsVisit(): number {
  const point = { x: 1, z: 2, list: [1, 2, 3] };
  visit(point, 3);
  return point.x + point.z + point.list.length;
}

type Target = { last: unknown };
const targets: any[] = [{ last: 0 }];
let keptList: any = null;
let keptMake: any = null;

function store(list: number[], make: () => number, rounds: number): number {
  spin(rounds);
  const target: Target = targets[targets.length - 1];
  target.last = list;
  target.last = make;
  target.last = 0;
  return list[0];
}

function callsStore(n: number): number {
  const list = [n, n + 1];
  const make = () => n * 2 + list.length;
  const first = store(list, make, 2);
  return first + list[0] + list.length + make();
}

function keep(value: any): void {
  if (Array.isArray(value)) {
    keptList = value;
    value[0] = 100;
    value.push(5);
  } else if (typeof value === "function") keptMake = value;
}

function runOverTheStack(depth: number): number {
  const point = { x: depth, z: depth + 1, list: [depth] };
  const list = [depth, depth + 1, depth + 2];
  const make = () => depth + list[1];
  return depth ? runOverTheStack(depth - 1) + point.x + point.list[0] + make() : point.z;
}

let total = 0;
for (let i = 0; i < 2000; i++) total += callsVisit() + callsStore(i & 7);
console.log("as typed", total, current.total);

current = impostor;
console.log("a method of another object", callsVisit(), callsVisit());
runOverTheStack(50);
console.log("kept", keptPoint.x, keptPoint.z, keptPoint.list.join("|"));

targets.push({
  set last(value: any) {
    keep(value);
  },
});
console.log("a setter", callsStore(1), callsStore(2));
runOverTheStack(50);
console.log("kept", keptMake(), keptList.join("|"));

targets.push(
  new Proxy(
    {},
    {
      set(_target: any, _key: any, value: any) {
        keep(value);
        return true;
      },
    },
  ),
);
console.log("a trap", callsStore(3), callsStore(4));
runOverTheStack(50);
console.log("kept", keptMake(), keptList.join("|"));

const made: any = JSON.parse("{}");
Object.defineProperty(made, ["l", "a", "s", "t"].join(""), {
  set(value: any) {
    keep(value);
  },
});
targets.push(made);
console.log("a setter under a key that is put together", callsStore(5), callsStore(6));
runOverTheStack(50);
console.log("kept", keptMake(), keptList.join("|"));
