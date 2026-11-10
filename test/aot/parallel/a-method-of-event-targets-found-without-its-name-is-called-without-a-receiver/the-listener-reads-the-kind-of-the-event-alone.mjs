// THE CONTROL: the listener never asks for the target: the program runs to its end, as under `bun run`.
let add, send;
const made = Object.create(EventTarget.prototype);
for (const key in made) {
  if (key.length === 16) add = made[key];
  if (key.length === 13) send = made[key];
}
add("ping", event => console.log(event.type));
console.log(send(new Event("ping")));
