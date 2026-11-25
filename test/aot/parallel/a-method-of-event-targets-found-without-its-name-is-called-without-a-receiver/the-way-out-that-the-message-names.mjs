// THE CONTROL: the way out that the message names. The name stands once in the program, so everything that the global object leads to is kept, and the calls work as under `bun run`.
let add, send;
const made = Object.create(EventTarget.prototype);
for (const key in made) {
  if (key.length === 16) add = made[key];
  if (key.length === 13) send = made[key];
}
function heard(event) {
  console.log(typeof event.target.process.finalization);
}
add("ping", heard);
send(new Event("ping"));
void dispatchEvent;
