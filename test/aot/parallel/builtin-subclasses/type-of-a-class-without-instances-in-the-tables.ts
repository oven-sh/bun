// Flags: --aot-check=verify-each-stage --aot-heat=everything-is-hot
// Exit code: 1
// The constructor of a class below Error always throws, so the class has no instances, and a field's type names the class.
// The run-time record of that type has no test for the class, and the check of the tables expects none.
const launder = new Function("value", process.argv[9] ?? "return value") as <V>(value: V) => V;
class Failure extends Error {
  constructor(public code: number) {
    launder(super("failure " + code));
  }
}
class Point {
  constructor() {}
  get sum(): number {
    return this.x + this.y;
  }
}
type Seen = { ref: WeakRef<object>; token: number; handle: object };
let tokens = 0;
const registry = new FinalizationRegistry<number>(token => {});
function watch(x: object): Seen {
  const token = ++tokens;
  const handle = {};
  return { ref: new WeakRef(x), token, handle };
}
class Wrapper<T> {
  constructor() {}
}
function make7(i: number): { held: Failure | null; seen: Seen } {
  const x: Failure = new Failure(i);
  return { held: x, seen: launder(watch(x)) };
}
async function case7(i: number): Promise<void> {
  const box = launder(make7(i));
}
for (let i = 700; i < 701; i++) launder(await launder(case7(i)));
