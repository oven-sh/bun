// Without a `get` trap the question goes on at the target, and the target is a proxy whose trap answers a function.
const answered = () => "printed by the answer";
const inner = new Proxy({}, { get() { return answered; } });
const below = Object.create(new Proxy(inner, { set() { return true; } }));
console.log(below);
