// THE CONTROL: what the listener reads off the global object is kept, because the program names it elsewhere: as under `bun run`.
let add, send;
const made = Object.create(EventTarget.prototype);
for (const key in made) {
  if (key.length === 16) add = made[key];
  if (key.length === 13) send = made[key];
}
add("ping", event => console.log(typeof event.target.process.argv, event.target === globalThis.globalThis));
console.log(send(new Event("ping")), process.argv.length > 0);
