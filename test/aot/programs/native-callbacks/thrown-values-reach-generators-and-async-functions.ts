// Thrown values: `throw` and `return` of a generator, an awaited rejection and a for-await loop bring values of any type into catch clauses inside coroutines that are typed for the program's own error class.
export {};

class Failure extends Error {
  code = 7;
}

let total = 0;

function weigh(error: Failure): number {
  return error instanceof Failure ? error.code : typeof error === "number" ? 100 : typeof error === "string" ? 10000 : error === undefined ? 1000000 : 100000000;
}

function* guarded(): Generator<number, number, void> {
  for (;;) {
    try {
      yield 1;
    } catch (error) {
      total += weigh(error as Failure);
    }
  }
}

const generator = guarded();
generator.next();
for (const value of [new Failure("own"), 5, "text", undefined, null]) generator.throw(value);
generator.return(0);

async function awaited(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch (error) {
    total += weigh(error as Failure) * 2;
  }
}
await awaited(Promise.reject(new Failure("own")));
await awaited(Promise.reject(6));
await awaited(new Response("{").json());
await awaited({ then: (resolve: unknown, reject: (reason: unknown) => void) => reject("thenable") } as any);
try {
  for await (const one of [Promise.resolve(1), Promise.reject("in a loop")]) total += one;
} catch (error) {
  total += weigh(error as Failure) * 3;
}
console.log(total);
