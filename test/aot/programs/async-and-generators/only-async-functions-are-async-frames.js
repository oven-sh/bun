// Only async functions wait, so only they are async frames of an error that native code creates. A plain function between two of them has handed on the promise and returned.
const { promises } = require("node:fs");
const missing = "/nonexistent-path/does-not-exist.txt";
const framesOf = error => JSON.stringify((error.stack ?? "").split("\n").slice(1).map(line => line.trim().replace(/\(.*[\\\/]/, "(")));
async function innermost() { return await promises.readFile(missing); }
function handsOn() { return innermost(); }
const arrowHandsOn = () => handsOn();
async function throughPlainFunctions() { return await arrowHandsOn(); }
async function inLoop() {
  let last;
  for (let i = 0; i < 3; i++) {
    try { last = await arrowHandsOn(); } catch (error) { last = error; }
  }
  throw last;
}
async function inTryFinally() {
  let finished = 0;
  try { return await handsOn(); } finally { finished++; await null; }
}
async function awaitsTwice() {
  await null;
  const first = handsOn();
  await null;
  return await first;
}
const asyncArrow = async () => await handsOn();
async function throughAsyncArrow() { return await asyncArrow(); }
class Reader {
  read() { return innermost(); }
  async readAll() { return await this.read(); }
  static async open() { return await new Reader().readAll(); }
}
async function* generates() { yield await handsOn(); }
async function throughGenerator() { for await (const value of generates()) return value; }
async function report(name, run) {
  try { await run(); console.log(name, "fulfilled"); } catch (error) { console.log(name, framesOf(error)); }
}
async function main() {
  for (const limit of [2, 10]) {
    Error.stackTraceLimit = limit;
    await report("plain functions " + limit, throughPlainFunctions);
    await report("an arrow handed in " + limit, () => throughPlainFunctions());
    await report("in a loop " + limit, inLoop);
    await report("try and finally " + limit, inTryFinally);
    await report("awaits twice " + limit, awaitsTwice);
    await report("an async arrow " + limit, throughAsyncArrow);
    await report("methods " + limit, Reader.open);
    await report("an async generator " + limit, throughGenerator);
  }
}
main();
