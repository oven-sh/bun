const answered = () => "printed by the answer";
const traps = { get() { return answered; } };
const below = Object.create(new Proxy({}, { __proto__: traps, set() { return true; } }));
console.log(below);
