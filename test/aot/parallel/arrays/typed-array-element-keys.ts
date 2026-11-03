// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
function show(value: unknown): string {
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null)
    return Array.isArray(value) ? "[" + value.join() + "]" : Object.prototype.toString.call(value);
  return typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
}
function attempt(label: string, action: () => unknown): void {
  let outcome: string;
  try {
    outcome = show(action());
  } catch (error) {
    outcome = (error as Error).name;
  }
  console.log(label + ": " + outcome);
}
function nameOfError(action: () => unknown): unknown {
  try {
    return action();
  } catch (error) {
    return (error as Error).name;
  }
}
const keys: unknown[] = [
  0,
  1,
  2,
  3,
  -1,
  1.5,
  -0,
  NaN,
  Infinity,
  2147483647,
  2147483648,
  4294967294,
  4294967295,
  4294967296,
  "0",
  "1",
  "01",
  "1.0",
  "-1",
  "-0",
  "1.5",
  "1e0",
  " 1",
  "length",
  "push",
  "missing",
  "",
  true,
  null,
  undefined,
  Symbol.iterator,
  1n,
  [1],
  {
    toString() {
      return "2";
    },
  },
];
function at(view: Uint8Array, key: any): unknown {
  return view[key];
}
function has(view: Uint8Array, key: any): boolean {
  return key in view;
}
function put(view: Uint8Array, key: any, value: number): void {
  view[key] = value;
}
function fractionAt(view: Float64Array, key: any): unknown {
  return view[key];
}
function putFraction(view: Float64Array, key: any, value: number): void {
  view[key] = value;
}
function stateOf(view: Uint8Array | Float64Array): string {
  return Array.from(view).join() + " " + Object.keys(view).join();
}
const kinds: [string, () => Uint8Array][] = [
  ["Uint8Array", () => new Uint8Array([10, 20, 30])],
  ["Buffer", () => Buffer.from([10, 20, 30])],
  ["a Uint8Array subclass", () => new (class Bytes extends Uint8Array {})([10, 20, 30])],
  ["a view of part of a buffer", () => new Uint8Array(new Uint8Array([0, 10, 20, 30, 0]).buffer, 1, 3)],
];
for (const [kind, make] of kinds) {
  keys.forEach((key, position) => {
    const label = kind + ", " + position + " " + show(key);
    const read = make();
    attempt(label + ", read", () => at(read, key));
    attempt(label + ", has", () => has(read, key));
    const stored = make();
    attempt(label + ", stored", () => (put(stored, key, 99), stateOf(stored)));
  });
}
keys.forEach((key, position) => {
  const label = "Float64Array, " + position + " " + show(key);
  attempt(label + ", read", () => fractionAt(new Float64Array([1.5, 2.5, 3.5]), key));
  const stored = new Float64Array([1.5, 2.5, 3.5]);
  attempt(label + ", stored", () => (putFraction(stored, key, 9.5), stateOf(stored)));
});

const resizable = new (ArrayBuffer as any)(4, { maxByteLength: 8 });
const tracking = new Uint8Array(resizable);
tracking.set([1, 2, 3, 4]);
attempt("a length-tracking view", () => [at(tracking, 3), at(tracking, 1), tracking.length].join());
resizable.resize(2);
attempt("after the buffer shrank", () => [at(tracking, 3), at(tracking, 1), tracking.length].join());
attempt("a store past the new end", () => (put(tracking, 3, 9), stateOf(tracking)));
resizable.resize(6);
attempt("after the buffer grew", () => [at(tracking, 3), at(tracking, 5), tracking.length].join());
const transferred = new ArrayBuffer(2);
const left = new Uint8Array(transferred);
left.set([5, 6]);
attempt("before the buffer is detached", () => [at(left, 0), left.length].join());
(transferred as any).transfer();
attempt("after the buffer is detached", () => [at(left, 0), has(left, 0), left.length].join());
attempt("a store after the buffer is detached", () => (put(left, 0, 9), stateOf(left)));
export {};
