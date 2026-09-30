import { bench, run } from "../runner.mjs";

var id = 0;

bench("process.emit (0 listeners)", () => {
  if (process.emit("bench:zero", 1)) throw new Error("expected no listeners");
});

const one = value => {
  id += value;
};
process.on("bench:one", one);

bench("process.emit (1 listener)", () => {
  if (!process.emit("bench:one", 1)) throw new Error("expected a listener");
});

const three = [
  value => {
    id += value;
  },
  value => {
    id += value;
  },
  value => {
    id += value;
  },
];
for (const listener of three) process.on("bench:three", listener);

bench("process.emit (3 listeners)", () => {
  if (!process.emit("bench:three", 1)) throw new Error("expected listeners");
});

bench("process.listenerCount", () => {
  if (process.listenerCount("bench:three") !== 3) throw new Error("expected 3 listeners");
});

// The default 'warning' listener prints every warning, so it is taken off for the run and put back after it.
const printers = process.listeners("warning");
for (const printer of printers) process.off("warning", printer);
const onWarning = () => {};
process.on("warning", onWarning);
const warning = new Error("bench");

// emitWarning emits 'warning' on process.nextTick, so each iteration waits for one more tick.
bench("process.emitWarning x 1000 (awaits delivery)", async () => {
  for (let i = 0; i < 1000; i++) process.emitWarning(warning);
  await new Promise(resolve => process.nextTick(resolve));
});

const toggled = () => {};

// Kept last: many removals turn the _events object of a node:events emitter into a dictionary, which slows emit.
bench("process.on + process.off", () => {
  process.on("bench:toggle", toggled);
  process.off("bench:toggle", toggled);
});

await run();

process.off("bench:one", one);
for (const listener of three) process.off("bench:three", listener);
process.off("warning", onWarning);
for (const printer of printers) process.on("warning", printer);
