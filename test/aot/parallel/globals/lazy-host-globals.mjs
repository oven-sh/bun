// Globals the host creates lazily.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const opaque = value => new CustomEvent("opaque", { detail: value }).detail; // the compiler can't see through a value returned by native code
const decoded = text => Buffer.from(text).toString(); // or a string decoded at run time
const told = [];
function attempt(action) {
  try {
    told.push(String(action()));
  } catch (error) {
    told.push(error instanceof TypeError ? error.name : error.name + ": " + error.message);
  }
}
function readCrypto() { return crypto; }
function readNavigator() { return navigator; }
function readPerformance() { return performance; }
function readChannel() { return BroadcastChannel; }
function readTimer() { return setTimeout; }
for (const read of [readCrypto, readNavigator, readPerformance, readChannel, readTimer]) {
  attempt(() => read() === read());
  attempt(() => typeof read());
}
attempt(() => readCrypto() === globalThis.crypto);
attempt(() => readNavigator() === globalThis.navigator);
attempt(() => readPerformance() === globalThis.performance);
attempt(() => readChannel() === globalThis.BroadcastChannel);
attempt(() => readTimer() === globalThis.setTimeout);
attempt(() => typeof readCrypto().randomUUID + " " + readChannel().name + " " + typeof readPerformance().now());
console.log(told.join("\n"));
