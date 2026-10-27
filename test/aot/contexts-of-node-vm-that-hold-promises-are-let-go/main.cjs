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
    "a chain of ten reactions, awaited outside",
    60,
    async () => {
      await vm.runInContext(
        "let p = Promise.resolve(0); for (let i = 0; i < 10; i++) p = p.then(x => x + 1); p",
        vm.createContext({}),
      );
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
    "an async function that nobody awaits",
    60,
    async () => {
      vm.runInContext("(async () => { await null; await 1; return 3; })(); 0", vm.createContext({}));
    },
  ],
  [
    "a promise that never settles, with three reactions",
    60,
    async () => {
      vm.runInContext(
        "const p = new Promise(() => {}); p.then(() => {}); p.finally(() => {}); (async () => { await p; })(); 0",
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
    "a rejection handled inside",
    60,
    async () => {
      await vm.runInContext("Promise.reject(new Error('no')).catch(e => e.message)", vm.createContext({}));
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
    "an outer resolved promise awaited inside",
    60,
    async () => {
      await vm.runInContext("(async () => (await outer) + 1)()", vm.createContext({ outer: Promise.resolve(1) }));
    },
  ],
  [
    "an inner promise resolved from outside",
    60,
    async () => {
      const context = vm.createContext({});
      const done = vm.runInContext("new Promise(r => { globalThis.settle = r; }).then(x => x + 1)", context);
      context.settle(1);
      await done;
    },
  ],
  [
    "Promise.all of a hundred",
    60,
    async () => {
      await vm.runInContext(
        "Promise.all(Array.from({ length: 100 }, (_, i) => Promise.resolve(i).then(x => x * 2)))",
        vm.createContext({}),
      );
    },
  ],
  [
    "an async generator read to its end",
    60,
    async () => {
      await vm.runInContext(
        "(async () => { async function* g() { for (let i = 0; i < 10; i++) yield i; } let s = 0; for await (const x of g()) s += x; return s; })()",
        vm.createContext({}),
      );
    },
  ],
  [
    "a promise settled by a timer of the outer realm",
    30,
    async () => {
      await vm.runInContext("new Promise(r => setTimeout(r, 0))", vm.createContext({ setTimeout }));
    },
  ],
  [
    "runInNewContext with an async function",
    60,
    async () => {
      await vm.runInNewContext("(async () => { await null; return x + 1; })()", { x: 1 });
    },
  ],
  [
    "one context, a new Script with a promise each time",
    300,
    async () => {
      await new vm.Script("Promise.resolve(" + serial++ + ").then(x => x + 1)").runInContext(shared);
    },
  ],
  [
    "one context, one Script run again and again",
    300,
    async () => {
      await oneScript.runInContext(shared);
    },
  ],
  [
    "one context, fifty inner functions await answers of 100 KB",
    40,
    async () => {
      await fiftyWaiters.runInContext(sharedWithAnswers);
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
    "a new context, fifty answers kept in a list until it ends",
    40,
    async () => {
      await vm.runInContext(
        "(async () => { const all = []; for (let i = 0; i < 50; i++) all.push(await answer()); return all.length; })()",
        vm.createContext({ answer }),
      );
    },
  ],
  [
    "the same fifty functions in this file",
    40,
    async () => {
      await Promise.all(
        Array.from({ length: 50 }, async () => {
          const text = await answer();
          return text.length;
        }),
      );
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
    "suspended in this file, 200 functions are done with their answers",
    24,
    () =>
      whileSuspended(later =>
        Promise.all(
          Array.from({ length: 200 }, async () => {
            const text = await answer();
            const n = text.length;
            await later;
            return n;
          }),
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
    "suspended in this file, 200 functions still need their answers",
    24,
    () =>
      whileSuspended(later =>
        Promise.all(
          Array.from({ length: 200 }, async () => {
            const text = await answer();
            await later;
            return text.length;
          }),
        ),
      ),
  ],
  [
    "a new context, eight calls of a function of this file that keeps twenty answers and writes them out at every step",
    6,
    async () => {
      await vm.runInContext(eightCallers, vm.createContext({ read: () => readTwentyTexts() }));
    },
  ],
  [
    "suspended in this file under a context, eight calls that keep twenty texts each still need their answers",
    6,
    () =>
      whileSuspended(
        later => vm.runInContext(eightCallers, vm.createContext({ read: () => readTwentyTexts(later) })),
        60,
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
        bytesEach: Math.round((late - early) / ((rounds - 3) * each)),
        heldWhileSuspended: held ? held - late : 0,
      }),
    );
  }
}
main();
