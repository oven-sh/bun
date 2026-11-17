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
let calls = 0;
Object.defineProperty(alias, "tag", { set(value) { calls++; }, configurable: true });
let seen = 0;
for (let turn = 0; turn < 300; turn++) seen = new Below().tag;
console.log(calls, seen);
