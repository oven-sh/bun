// The function is written elsewhere: where the handler is written nobody sees whether it has a `this`.
const answered = () => "printed by the answer";
const lay = function (target, key) { this.get = () => answered; return true; };
function make() { return new Proxy({}, { has: lay }); }
const proxy = make();
const below = Object.create(proxy);
console.log("anything" in proxy);
console.log(below);
