// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: the judge of calls held the entry by value to all that the body believes, and no test tells whose generator an object is
// `byHand` goes by what its callers leave: the generator of `yieldsPromises`. Its entry by value can ask for an async generator and no more: a door asks for the testable part of what its body believes.
import { AsyncLocalStorage } from "node:async_hooks";
const store = new AsyncLocalStorage<string>();
async function* yieldsPromises(name: string) {
  yield store.run("inside " + name, () => Promise.resolve(name + " 2"));
  yield { then(resolve: (value: string) => void) { resolve(name + " 3"); } } as unknown as string;
}
async function byHand(generator: AsyncGenerator<string, unknown, unknown>) {
  const step = await generator.next();
  console.log(step.value, step.done);
}
store.run("i", () => byHand(yieldsPromises("g9")));
