// What the code in a ShadowRealm finds on the globals that the runtime fills from its own modules when they are first read.
const realm = new ShadowRealm();
function ask(text) {
  try {
    return realm.evaluate(`(() => { try { return String(${text}); } catch (error) { return "threw " + error.name; } })()`);
  } catch (error) {
    return "left the realm as " + error.constructor.name;
  }
}
for (const text of [
  "typeof process.stdout.write",
  "typeof process.stderr.write",
  "typeof process.nextTick",
  "typeof process.getBuiltinModule('node:os').platform()",
  "process.getBuiltinModule('node:url').pathToFileURL('/a').protocol",
  "process.getBuiltinModule('node:path') === process.getBuiltinModule('path')",
  "typeof Bun.sql",
  "typeof new ReadableStream().getReader",
  "Buffer.from('ab').toString('hex')",
  "Bun.inspect({ a: 1 })",
  "queueMicrotask(() => { globalThis.queued = 'in a job'; })",
  "setTimeout(() => { globalThis.timed = 'in a timer'; }, 1) && 1",
]) {
  console.log(text, "=", ask(text));
}
await new Promise(resolve => setTimeout(resolve, 20));
console.log(ask("[globalThis.queued, globalThis.timed]"));
