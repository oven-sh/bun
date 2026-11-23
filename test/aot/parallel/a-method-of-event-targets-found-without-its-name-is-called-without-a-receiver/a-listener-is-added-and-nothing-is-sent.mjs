// THE CONTROL: nothing ever reads the global object off an event: the program runs to its end, as under `bun run`.
let add, send;
const made = Object.create(EventTarget.prototype);
for (const key in made) {
  if (key.length === 16) add = made[key];
  if (key.length === 13) send = made[key];
}
add("ping", () => {});
console.log("the end", typeof send);
