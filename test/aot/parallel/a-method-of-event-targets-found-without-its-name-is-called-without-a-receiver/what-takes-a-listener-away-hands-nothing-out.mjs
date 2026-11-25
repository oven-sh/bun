// THE CONTROL: removeEventListener exposes nothing: without a receiver it works on the global object, as under `bun run`, found without its name or taken by it.
let remove;
const made = Object.create(EventTarget.prototype);
for (const key in made) if (key.length === 19) remove = made[key];
function heard() {}
console.log(remove("ping", heard));
const named = EventTarget.prototype.removeEventListener;
console.log(named("ping", heard));
