"use strict";
const vm = require("node:vm");

const tick = () => new Promise(resolve => setImmediate(resolve));
process.on("unhandledRejection", () => {});

const forever = new Promise(() => {});
const shared = vm.createContext({});
let serial = 0;
const answer = () => new Promise(resolve => setImmediate(() => resolve("x".repeat(100000) + serial++)));
const sharedWithAnswers = vm.createContext({ answer });
const fiftyWaiters = new vm.Script(
  "Promise.all(Array.from({ length: 50 }, async () => { const text = await answer(); return text.length; }))",
);
const oneScript = new vm.Script("(async () => { await null; return 1; })()");

async function readTwentyTexts(gate) {
  const seen = [];
  let written = 0;
  for (let step = 0; step < 20; step++) {
    seen.push({ step, text: await answer() });
    written += JSON.stringify(seen).length;
  }
  if (gate) await gate;
  return "read " + seen.length + " texts, wrote " + written;
}
const eightCallers = "Promise.all(Array.from({ length: 8 }, () => read())).then(all => all.length)";

async function whileSuspended(start, turns = 4) {
  let release;
  const later = new Promise(resolve => {
    release = resolve;
  });
  const done = start(later);
  for (let i = 0; i < turns; i++) await tick();
  Bun.gc(true);
  const held = process.memoryUsage().heapUsed;
  release();
  await done;
  return held;
}

// [name, contexts a round, what one turn does]
const scenarios = [
  [
    "a context without a promise",
    60,
    async () => {
      vm.runInContext("1 + 1", vm.createContext({}));
    },
  ],
  [
    "an async function with three awaits, awaited outside",
    60,
    async () => {
      await vm.runInContext(
        "(async () => { await null; await 1; await Promise.resolve(2); return 3; })()",
        vm.createContext({}),
      );
    },
  ],
  [
    "an async function suspended for ever that holds 100 KB",
    60,
    async () => {
      vm.runInContext(
        "(async () => { const big = new Array(12500).fill(1.5); await new Promise(() => {}); return big; })(); 0",
        vm.createContext({}),
      );
    },
  ],
  [
    "a rejection that nobody handles",
    60,
    async () => {
      vm.runInContext("Promise.reject(new Error('no')); 0", vm.createContext({}));
    },
  ],
  [
    "a new context, fifty inner functions await answers of 100 KB",
    40,
    async () => {
      await fiftyWaiters.runInContext(vm.createContext({ answer }));
    },
  ],
  [
    "suspended in a context, 200 functions are done with their answers",
    24,
    () =>
      whileSuspended(later =>
        vm.runInContext(
          "Promise.all(Array.from({ length: 200 }, async () => { const text = await answer(); const n = text.length; await later; return n; }))",
          vm.createContext({ answer, later }),
        ),
      ),
  ],
  [
    "suspended in a context, 200 functions still need their answers",
    24,
    () =>
      whileSuspended(later =>
        vm.runInContext(
          "Promise.all(Array.from({ length: 200 }, async () => { const text = await answer(); await later; return text.length; }))",
          vm.createContext({ answer, later }),
        ),
      ),
  ],
  [
    "a reaction on an outer promise that never settles",
    60,
    async () => {
      vm.runInContext("forever.then(() => {}); 0", vm.createContext({ forever }));
    },
  ],
];

// In a callback of the event loop: under a promise job the stack still holds the handler of an earlier job.
const collect = () =>
  new Promise(resolve =>
    setImmediate(() => {
      Bun.gc(true);
      resolve(process.memoryUsage().heapUsed);
    }),
  );

async function settle() {
  for (let i = 0; i < 3; i++) await tick();
  await collect();
  return await collect();
}

async function main() {
  for (const [name, each, turn] of scenarios) {
    // Ninety contexts at 2 KB outweigh the last answer and the last context, which a reading may find on the stack.
    const rounds = Math.max(8, Math.ceil(90 / each) + 3);
    const after = [];
    let held = 0;
    for (let round = -2; round < rounds; round++) {
      for (let i = 0; i < each; i++) held = Math.max(held, (await turn()) ?? 0);
      const used = await settle();
      if (round >= 0) after.push(used);
    }
    const early = Math.min(...after.slice(0, 3));
    const late = Math.min(...after.slice(-3));
    console.log(
      JSON.stringify({
        name,
        grows: Math.round((late - early) / ((rounds - 3) * each)) > 2048,
        holdsTheAnswers: (held ? held - late : 0) > 10_000_000,
      }),
    );
  }
}
main();
