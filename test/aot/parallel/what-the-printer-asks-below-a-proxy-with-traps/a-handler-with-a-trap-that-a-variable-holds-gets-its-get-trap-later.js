const answered = () => "printed by the answer";
const handler = { set() { return true; } };
const below = Object.create(new Proxy({}, handler));
handler.get = () => answered;
console.log(below);
