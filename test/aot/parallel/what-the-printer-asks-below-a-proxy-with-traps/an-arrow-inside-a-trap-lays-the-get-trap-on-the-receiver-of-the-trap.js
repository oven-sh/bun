const answered = () => "printed by the answer";
const proxy = new Proxy({}, { has(target, key) { const lay = () => { this.get = () => answered; }; lay(); return true; } });
const below = Object.create(proxy);
console.log("anything" in proxy);
console.log(below);
