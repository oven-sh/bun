// THE CONTROL: nothing ever reads the global object off the event: the program runs to its end, as under `bun run`.
let send;
const made = Object.create(EventTarget.prototype);
for (const key in made) if (key.length === 13) send = made[key];
console.log(send(new Event("ping")));
