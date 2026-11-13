const answered = () => "printed by the answer";
const more = { get() { return answered; } };
const below = Object.create(new Proxy({}, { set() { return true; }, ...more }));
console.log(below);
