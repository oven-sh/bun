// A field that every statement in sight stores booleans into is laid anew as a getter by Object.defineProperty under a key that is put together at run time.
class Flags {
  a = false;
  b = false;
  c = false;
  d = false;
}
function make(on: boolean) {
  const flags = new Flags();
  flags.a = on;
  flags.d = !on;
  return flags;
}
function read(flags: Flags) {
  return String(flags.a) + " " + String(flags.b) + " " + String(flags.c) + " " + String(flags.d) + " " + Object.keys(flags).join();
}
let calls = 0;
function deed(flags: Flags, key: string) {
  Object.defineProperty(flags, key, { get: () => "got " + ++calls, enumerable: true, configurable: true });
  return read(flags);
}
const key = ["", "c"].join("");
console.log(read(make(true)));
console.log(deed(make(true), key));
let all = "";
for (let i = 0; i < 5; i++) all += deed(make(i > 2), key) + ";";
console.log(all);
console.log(read(make(false)), calls);
