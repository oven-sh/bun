import { setCurrent, shared } from "./shared.js";
import { show } from "./show.js";
import * as waiters from "./waiters.js";

console.log("this file is strict:", (function () {
  return this === undefined;
})());

async function attempt(label, run) {
  try {
    console.log(label, show(await run()));
  } catch (error) {
    console.log(label, "threw", error.constructor.name);
  }
}
function gate() {
  let open;
  const promise = new Promise(resolve => (open = resolve));
  return { promise, open };
}
for (let i = 0; i < 500; i++) {
  await waiters.sizeAroundAnAwait(0);
  await waiters.countAroundAnAwait(0);
  await waiters.parameterAroundAnAwait({ value: i }, 0);
  await waiters.bindingAroundAnAwait(0);
}
const kinds = { text: "ab", like: { length: "long" }, number: 7, none: null, big: 2n, object: { valueOf: () => 5, length: 9 }, list: [4] };
for (const kind in kinds) {
  shared.list = [1, 2, 3];
  shared.count = 1;
  setCurrent([1, 2, 3]);
  const box = { value: 1 };
  const held = gate();
  const waiting = [
    attempt("size, " + kind, () => waiters.sizeAroundAnAwait(held.promise)),
    attempt("count, " + kind, () => waiters.countAroundAnAwait(held.promise)),
    attempt("parameter, " + kind, () => waiters.parameterAroundAnAwait(box, held.promise)),
    attempt("binding, " + kind, () => waiters.bindingAroundAnAwait(held.promise)),
    attempt("held in a local, " + kind, () => waiters.heldInALocal(held.promise)),
  ];
  shared.list = kinds[kind];
  shared.count = kinds[kind];
  box.value = kinds[kind];
  setCurrent(kinds[kind]);
  held.open();
  await Promise.all(waiting);

  shared.list = [1, 2, 3];
  const steps = waiters.sizeAroundAYield();
  const first = steps.next();
  shared.list = kinds[kind];
  await attempt("yield, " + kind, () => [first.value, steps.next(kinds[kind]).value]);

  const streamBox = { value: 1 };
  await attempt("stream, " + kind, async () => {
    const seen = [];
    for await (const item of waiters.streamed(streamBox)) {
      seen.push(item);
      streamBox.value = kinds[kind];
    }
    return seen;
  });

  const loopBox = { value: 1 };
  const gates = [gate(), gate(), gate()];
  const looping = attempt("loop, " + kind, () => waiters.loopWithAwaits(loopBox, gates.map(each => each.promise)));
  gates[0].open();
  await gates[0].promise;
  loopBox.value = kinds[kind];
  gates[1].open();
  gates[2].open();
  await looping;
}
