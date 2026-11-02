// An operation that does nothing but look and throw allocates the error that it throws, so a collection may lie between it and the handler.
// Flags: --aot-validate
// Env: BUN_JSC_slowPathAllocsBetweenGCs=1
// Env: BUN_JSC_scribbleFreeCells=1
class Box {
  #secret = 1;
  static read(value: any): number {
    return value.#secret;
  }
  static has(value: any): boolean {
    return #secret in value;
  }
}

const weak = new WeakMap<object, number>();
const weakSet = new WeakSet<object>();
const keys: object[] = [];
for (let index = 0; index < 64; index++) {
  const key = { index };
  weak.set(key, index);
  weakSet.add(key);
  if (index % 8 === 0) keys.push(key);
}

type Attempt = (value: any) => unknown;
const attempts: [string, Attempt, unknown][] = [
  ["private name read", value => Box.read(value), {}],
  ["private name read of a primitive", value => Box.read(value), 5],
  ["private name tested", value => Box.has(value), 5],
  ["call of a number", value => value(), 5],
  ["call of a member", value => value.member(), {}],
  ["construction", value => new value(), {}],
  ["read of null", value => value.length, null],
  ["detached array", value => value.fill(1), detached()],
  ["in a primitive", value => "name" in value, 5],
  ["instance of a number", value => ({}) instanceof value, 5],
  ["symbol to number", value => +value, Symbol.iterator],
  ["big integer and number", value => value + 1, 1n],
  ["spread of a number", value => [...value], 5],
  ["destructured null", value => { const { a } = value; return a; }, null],
];

function detached(): Uint8Array {
  const bytes = new Uint8Array(8);
  structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
  return bytes;
}

function around(attempt: Attempt, value: unknown, first: object, second: object): string {
  let sum = weak.get(first)!;
  let isThere = weakSet.has(first);
  const holder: { error: unknown; before: object } = { error: null, before: first };
  let thrown: any = null;
  try {
    attempt(value);
  } catch (error) {
    thrown = error;
  }
  holder.error = thrown;
  sum += weak.get(second)!;
  isThere &&= weakSet.has(second);
  return `${(holder.error as Error)?.constructor.name} ${sum} ${isThere}`;
}

for (const [name, attempt, value] of attempts) {
  const seen = new Set<string>();
  for (let round = 0; round + 1 < keys.length; round++) seen.add(around(attempt, value, keys[round], keys[round + 1]));
  console.log(name + ":", [...seen].join(" | "));
}
