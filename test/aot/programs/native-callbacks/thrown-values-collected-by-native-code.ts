// Thrown values: Promise.allSettled, Promise.any, AggregateError, `cause` and a settled promise's record keep what was thrown and hand it back under `any`; the program reads it as its own error class.
export {};

class Failure extends Error {
  code = 7;
}

function weigh(failure: Failure): number {
  return failure instanceof Failure ? failure.code : typeof failure === "number" ? 100 : typeof failure === "string" ? 10000 : failure === undefined ? 1000000 : 100000000;
}

let total = weigh(new Failure("own"));
for (const outcome of await Promise.allSettled([Promise.reject(new Failure("a")), Promise.reject(5), Promise.reject("text"), Promise.reject(), 1])) {
  if (outcome.status === "rejected") total += weigh(outcome.reason);
}
try {
  await Promise.any([Promise.reject(6), Promise.reject(new Failure("b"))]);
} catch (error) {
  for (const inner of (error as AggregateError).errors) total += weigh(inner);
}
total += weigh(new Error("outer", { cause: "cause" }).cause as Failure);
total += weigh(new AggregateError(new Set([7])).errors[0]);
console.log(total);
