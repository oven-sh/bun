function Base() {}
Base.prototype.hello = function () { return "base"; };
function Below() { this.tag = 1; }
function risky() { throw new Error("stop"); }
const made = Object.create(Base.prototype);
let kept = made;
let alias = null;
try { Below.prototype = made; risky(); kept = null; } catch (error) { alias = kept; }
Object.setPrototypeOf(alias, { hello() { return "other"; } });
let answers = "";
for (let i = 0; i < 300; i++) answers = new Below().hello();
console.log(answers);
