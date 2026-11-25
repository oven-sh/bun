// THE CONTROL: the program lets the global object go by another road: it may print it. Nothing that it leads to is left out, and the calls work as under `bun run`.
let add, send;
const made = Object.create(EventTarget.prototype);
for (const key in made) {
  if (key.length === 16) add = made[key];
  if (key.length === 13) send = made[key];
}
function heard(event) {
  console.log(typeof event.target.process.finalization);
}
if (process.argv.length > 99) console.log(globalThis);
add("ping", heard);
send(new Event("ping"));
