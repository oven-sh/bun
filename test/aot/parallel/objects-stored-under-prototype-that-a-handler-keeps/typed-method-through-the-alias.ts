function Base(this: any) {}
Base.prototype.hello = function () { return "base"; };
function Below(this: any) { this.tag = 1; }
function risky() { throw new Error("stop"); }
const made = Object.create(Base.prototype);
let kept = made;
let alias: any = null;
try { Below.prototype = made; risky(); kept = null; } catch (error) { alias = kept; }
alias.hello = function () { return "alias"; };
let answers = "";
for (let i = 0; i < 300; i++) answers = new (Below as any)().hello();
console.log(answers);
