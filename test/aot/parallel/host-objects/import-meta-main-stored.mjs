// A store into import.meta.main is seen by the reads behind it, whichever way it goes.
const say = value => console.log(typeof value + " " + String(value));
function read() {
  return import.meta.main;
}
say(import.meta.main);
import.meta.main = "stored";
say(import.meta.main);
say(read());
const meta = import.meta;
meta.main = 5;
say(import.meta.main);
Reflect.set(import.meta, ["ma", "in"].join(""), "by a key");
say(read());
Object.defineProperty(import.meta, "main", { value: false, configurable: true, writable: true });
if (import.meta.main) console.log("runs as main");
else console.log("does not");
