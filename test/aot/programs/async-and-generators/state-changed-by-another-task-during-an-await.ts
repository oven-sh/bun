// An async function or a generator that was started earlier holds an object in its suspended frame and stores to it while the caller waits: what the caller reads behind its own await is the new state.
async function report(name: string, run: () => unknown) {
  let result: string;
  try {
    result = String(await run());
  } catch (error) {
    result = "threw " + (error instanceof Error ? error.name : typeof error);
  }
  console.log(name, result);
}
class Dog {
  legs = 4;
}
const later = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

await report("cleared by an async arrow", async () => {
  const owner: { pet: Dog | null } = { pet: new Dog() };
  const other = (async () => {
    await later();
    owner.pet = null;
  })();
  if (owner.pet === null) return "null";
  await other;
  return owner.pet.legs;
});

async function clearLater(owner: { pet: Dog | null }) {
  await later();
  owner.pet = null;
}
await report("cleared by an async function that takes the object", async () => {
  const owner: { pet: Dog | null } = { pet: new Dog() };
  const other = clearLater(owner);
  const before = owner.pet === null;
  await other;
  return [before, owner.pet === null].join();
});

await report("counted by an async function that is not awaited", async () => {
  const counter = { n: 1 };
  (async () => {
    await null;
    counter.n += 10;
    await null;
    counter.n += 100;
  })();
  const first = counter.n;
  await later();
  return [first, counter.n].join();
});

function* steps(state: { n: number }) {
  state.n += 1;
  yield state.n;
  state.n += 10;
  yield state.n;
}
await report("changed by a generator between two reads", () => {
  const state = { n: 0 };
  const iterator = steps(state);
  const before = state.n;
  iterator.next();
  const between = state.n;
  iterator.next();
  return [before, between, state.n].join();
});

await report("an element stored while the caller waits", async () => {
  const list = [1, 2, 3];
  const other = (async () => {
    await later();
    list[1] = 20;
    list.push(4);
  })();
  const before = list[1] + list.length;
  await other;
  return [before, list[1] + list.length].join();
});
