// A store through `super` goes to the receiver, and the receiver of a trap is the handler.
const answered = () => "printed by the answer";
const proxy = new Proxy({}, { has(target, key) { super.get = () => answered; return true; } });
const below = Object.create(proxy);
console.log("anything" in proxy);
console.log(below);
