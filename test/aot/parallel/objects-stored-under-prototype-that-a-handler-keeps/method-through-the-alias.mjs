function Base() {}
Base.prototype.hello = function () { return "base"; };
function Below() { this.tag = 1; }
function risky() { throw new Error("stop"); }
const made = Object.create(Base.prototype);
let kept = made;
let alias = null;
try {
  Below.prototype = made;
  risky();
  kept = null;
} catch (error) {
  alias = kept;
}
alias.hello = function () { return "alias"; };
let text = "";
for (let turn = 0; turn < 300; turn++) text = new Below().hello();
console.log(text);
