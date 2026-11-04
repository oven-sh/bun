// A field that every statement in sight stores booleans into is stored a text under a key that is put together at run time.
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
  return String(flags.a) + " " + String(flags.b) + " " + String(flags.c) + " " + String(flags.d) + " " + typeof flags.b;
}
function deed(flags: Flags, key: string, value: unknown) {
  (flags as any)[key] = value;
  return read(flags);
}
const key = ["", "b"].join("");
console.log(read(make(true)));
console.log(deed(make(true), key, "text"));
let all = "";
for (let i = 0; i < 6; i++) all += deed(make(i > 2), key, [1.5, "two", null, undefined, { three: 3 }, true][i]) + ";";
console.log(all);
console.log(read(make(false)));
