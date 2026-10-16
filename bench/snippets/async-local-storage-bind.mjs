// AsyncLocalStorage.bind(fn): the cost to create a bound function and the cost to call it.
// AsyncLocalStorage.snapshot() is the control: it shares the install/call/restore body.
//
// Each case runs 1,000 operations. The created functions go into `kept`, so that
// the JIT cannot drop the creation.

import { AsyncLocalStorage } from "node:async_hooks";
import { bench, group, run } from "../runner.mjs";

const N = 1000;
const kept = new Array(N).fill(null);
const als = new AsyncLocalStorage();

function arity0() {}
function arity2(a, b) {}

const { bound0, bound2, owner, runInSnapshot } = als.run("store", () => ({
  bound0: AsyncLocalStorage.bind(arity0),
  bound2: AsyncLocalStorage.bind(arity2),
  owner: {
    method: AsyncLocalStorage.bind(function () {
      return this;
    }),
  },
  runInSnapshot: AsyncLocalStorage.snapshot(),
}));

group("create x 1000", () => {
  bench("bind(fn), fn.length 0", () => {
    for (let i = 0; i < N; i++) kept[i] = AsyncLocalStorage.bind(arity0);
  });
  bench("bind(fn), fn.length 2", () => {
    for (let i = 0; i < N; i++) kept[i] = AsyncLocalStorage.bind(arity2);
  });
  bench("bind(() => {}), new closure", () => {
    for (let i = 0; i < N; i++) kept[i] = AsyncLocalStorage.bind(() => {});
  });
  bench("bind((a, b) => {}), new closure", () => {
    for (let i = 0; i < N; i++) kept[i] = AsyncLocalStorage.bind((a, b) => {});
  });
  bench("snapshot()", () => {
    for (let i = 0; i < N; i++) kept[i] = AsyncLocalStorage.snapshot();
  });
});

group("call x 1000", () => {
  bench("bound()", () => {
    for (let i = 0; i < N; i++) bound0();
  });
  bench("bound(1, 2)", () => {
    for (let i = 0; i < N; i++) bound2(1, 2);
  });
  bench("owner.method()", () => {
    for (let i = 0; i < N; i++) owner.method();
  });
  bench("snapshot()(fn)", () => {
    for (let i = 0; i < N; i++) runInSnapshot(arity0);
  });
});

await als.run("store", () => run());
