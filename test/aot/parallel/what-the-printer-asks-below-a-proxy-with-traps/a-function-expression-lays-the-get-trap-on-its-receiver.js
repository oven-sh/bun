const answered = () => "printed by the answer";
const proxy = new Proxy({}, { has: function (target, key) { this.get = () => answered; return true; } });
const below = Object.create(proxy);
console.log("anything" in proxy);
console.log(below);
