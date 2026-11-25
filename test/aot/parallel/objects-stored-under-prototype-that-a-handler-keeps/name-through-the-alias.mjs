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
alias.extra = 5;
let seen = 0;
for (let turn = 0; turn < 300; turn++) seen = new Below().extra;
console.log(seen);
