// What a ShadowRealm imports of the modules that come with the runtime, through importValue() and from a text that it evaluates. Each realm has its own.
const realm = new ShadowRealm();
async function show(label, run) {
  try {
    console.log(label, JSON.stringify(await run()));
  } catch (error) {
    console.log(label, error?.constructor?.name);
  }
}
await show("a text", () => realm.importValue("node:path", "sep"));
await show("a function", async () => (await realm.importValue("node:path", "join"))("a", "b"));
await show("without the scheme", async () => (await realm.importValue("path", "basename"))("/a/b.txt"));
await show("a second module", async () => typeof (await realm.importValue("node:util", "format")));
await show("called", async () => (await realm.importValue("node:util", "format"))("%s-%d", "a", 1));
await show("a native module", async () => typeof (await realm.importValue("node:buffer", "isUtf8")));
await show("a name that is not exported", () => realm.importValue("node:path", "nothing"));
await show("an object", () => realm.importValue("node:path", "posix"));
await show("from inside", async () =>
  realm.evaluate("globalThis.loaded = import('node:os').then(os => { globalThis.eol = os.EOL; }); 1"),
);
await new Promise(resolve => setTimeout(resolve, 10));
await show("read inside", async () => realm.evaluate("globalThis.eol"));
await show("its own objects", async () =>
  realm.evaluate("import('node:path').then(path => { globalThis.own = path.join instanceof Function; }); 1"),
);
await new Promise(resolve => setTimeout(resolve, 10));
await show("own", async () => realm.evaluate("globalThis.own"));
import { sep } from "node:path";
console.log("outside", JSON.stringify(sep));
const second = new ShadowRealm();
await show("another realm", () => second.importValue("node:path", "delimiter"));
const third = new ShadowRealm();
third.evaluate(
  "globalThis.seen = []; import('node:events').then(events => { const emitter = new events.EventEmitter(); emitter.on('x', value => seen.push(value)); emitter.emit('x', 'heard'); }, error => seen.push(error.name)); 1",
);
await new Promise(resolve => setTimeout(resolve, 10));
await show("an emitter inside", async () => third.evaluate("seen.join(' ')"));
