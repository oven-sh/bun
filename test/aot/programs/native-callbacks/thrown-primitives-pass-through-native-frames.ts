// Thrown values: a primitive that a callback throws passes through sort, JSON.stringify, Array.from, replace and a Proxy and reaches a catch clause that reads `message` and `code` as if it were the program's own error.
class Failure extends Error {
  code = 7;
}

let total = 0;

function weigh(error: Failure): number {
  if (error === null || error === undefined) return 1000000;
  return typeof error.message === "string" ? error.code : typeof error === "number" ? 100 + error : typeof error === "string" ? 10000 + (error as string).length : 100000000;
}

weigh(new Failure("own"));
const thrower = (value: unknown) => (): never => {
  throw value;
};
const attempts: (() => unknown)[] = [
  () => [2, 1].sort(thrower(42)),
  () => JSON.stringify({ get a() { throw "text"; } }),
  () => Array.from([1], thrower(null)),
  () => "a".replace("a", thrower(undefined)),
  () => new Proxy<any>({}, { get: thrower(1n) }).x,
  () => String({ toString: thrower(new Failure("inside")) }),
  () => new Map([[1, 1]]).forEach(thrower(false)),
  () => Reflect.apply(thrower(Symbol.iterator), null, []),
  () => structuredClone({ get a() { throw 5; } }),
];
for (const attempt of attempts) {
  try {
    attempt();
  } catch (error) {
    total += weigh(error as Failure);
  }
}
console.log(total);
