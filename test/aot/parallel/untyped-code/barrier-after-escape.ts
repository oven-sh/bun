// A new object escapes into an object that the concurrent collector may be marking, and only then has a reference stored into it. Once it has escaped, the collector can mark and scan it at any time, so the later store needs its write barrier even though nothing was allocated in between. The options in the .json file keep the collector running and make it verify every marking.
// Env: BUN_JSC_collectContinuously=1
// Env: BUN_JSC_useGenerationalGC=0
// Env: BUN_JSC_verifyGC=1
class Leaf { constructor(public tag: number) {} }
class Branch { first: Leaf | null = null; second: Leaf | null = null; }
class Root { branch: Branch | null = null; other: Branch | null = null; pair: (Leaf | null)[] | null = null; read: (() => Leaf | null) | null = null; }
const spare = new Leaf(-1);
const createBranch = (): Branch => new Branch();
const opaque = new Function("value", "return value") as <T>(value: T) => T;
function storeIntoObject(root: Root, a: Leaf, b: Leaf, seed: number): number {
  const branch = new Branch();
  root.branch = branch;
  let x = seed;
  x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x);
  x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x);
  x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x);
  x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x);
  branch.first = x > 2 ? spare : a;
  branch.second = x > 2 ? spare : b;
  return x;
}
function storeIntoArray(root: Root, leaf: Leaf, seed: number): number {
  const pair: (Leaf | null)[] = [null, null];
  root.pair = pair;
  let x = seed;
  x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x);
  x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x);
  x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x);
  x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x);
  pair[1] = x > 2 ? spare : leaf;
  return x;
}
function storeIntoEnvironment(root: Root, leaf: Leaf, seed: number): number {
  let current: Leaf | null = null;
  root.read = () => current;
  let x = seed;
  x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x);
  x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x);
  x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x);
  x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x);
  current = x > 2 ? spare : leaf;
  return x;
}
function storeByName(bag: any, leaf: Leaf, seed: number): number {
  const loose: any = opaque({ first: null });
  bag.loose = loose;
  let x = seed;
  x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x);
  x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x);
  x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x);
  x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x); x = 1 / (1 + x);
  loose.first = x > 2 ? spare : leaf;
  return x;
}
function storeAfterAllocation(root: Root, a: Leaf, b: Leaf): void {
  const early = createBranch(), filler = new Leaf(-2), late = createBranch();
  early.first = a;
  late.first = b;
  early.second = filler;
  root.branch = early;
  root.other = late;
}
const size = 256;
const createRoots = (): Root[] => { const list: Root[] = []; for (let i = 0; i < size; i++) list.push(new Root()); return list; };
const objectRoots = createRoots(), arrayRoots = createRoots(), environmentRoots = createRoots(), allocationRoots = createRoots();
const bags: any[] = [];
for (let i = 0; i < size; i++) bags.push({ loose: null });
const wrong = [0, 0, 0, 0, 0, 0, 0];
function check(kind: number, leaf: Leaf | null, tag: number): void { if (leaf === null || leaf.tag !== tag + kind) wrong[kind]++; }
let sum = 0;
for (let round = 0; round < 600; round++) {
  for (let i = 0; i < size; i++) {
    const tag = (round * size + i) * 8;
    sum += storeIntoObject(objectRoots[i], new Leaf(tag), new Leaf(tag + 1), i);
    sum += storeIntoArray(arrayRoots[i], new Leaf(tag + 2), i);
    sum += storeIntoEnvironment(environmentRoots[i], new Leaf(tag + 3), i);
    sum += storeByName(bags[i], new Leaf(tag + 4), i);
    storeAfterAllocation(allocationRoots[i], new Leaf(tag + 5), new Leaf(tag + 6));
  }
  for (let i = 0; i < size; i++) {
    const tag = (round * size + i) * 8;
    check(0, objectRoots[i].branch!.first, tag); check(1, objectRoots[i].branch!.second, tag); check(2, arrayRoots[i].pair![1], tag); check(3, environmentRoots[i].read!(), tag);
    check(4, bags[i].loose.first, tag); check(5, allocationRoots[i].branch!.first, tag); check(6, allocationRoots[i].other!.first, tag);
  }
}
console.log("wrong: " + wrong.join());
console.log("sum is finite: " + Number.isFinite(sum));
export {};
