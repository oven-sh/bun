// Guards that fail once: async context created or entered. It prints what plain Bun prints.
const { AsyncLocalStorage } = require("node:async_hooks");
const trip = process.argv[2] === "trip";
const N = Number(process.argv[3] ?? 2000000);
const variant = process.argv[4] ?? "call";
const entered = process.argv[2] === "entered";
const storage = trip || entered ? new AsyncLocalStorage() : undefined;

async function finishesAtOnce(i) {
  return i + 1;
}
async function suspendsOnce(i) {
  await null;
  return i + 1;
}
async function awaitsCalls() {
  let sum = 0;
  for (let i = 0; i < N; i++) sum = (sum + (await finishesAtOnce(i))) | 0;
  return sum;
}
async function awaitsSuspendedCalls() {
  let sum = 0;
  for (let i = 0; i < N; i++) sum = (sum + (await suspendsOnce(i))) | 0;
  return sum;
}
async function awaitsPromises() {
  let sum = 0;
  for (let i = 0; i < N; i++) sum = (sum + (await Promise.resolve(i))) | 0;
  return sum;
}
async function awaitsNumbers() {
  let sum = 0;
  for (let i = 0; i < N; i++) sum = (sum + (await i)) | 0;
  return sum;
}
const loops = { call: awaitsCalls, suspended: awaitsSuspendedCalls, promise: awaitsPromises, number: awaitsNumbers };
const start = () => loops[variant]().then(sum => console.log(variant, sum, storage?.getStore()));
if (entered) storage.run("store", start);
else start();
