// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: a belief about what a call on a built-in object enters shows first as a false proof about what the call gives
let calls = 0;
const own = function () { calls++; return { value: 3, done: "never" }; };
function* steps() { for (;;) yield 3; }
Object.assign(steps.prototype, { next: own });
const made = steps();

let kept = false;
function look() { return typeof kept + (kept === "never" ? "!" : "?"); }
function sum(turns) { let s = ""; for (let i = 0; i < turns; i++) { kept = made.next().done; s += look(); } return s; }
console.log("SAID", sum(Number("4")), calls);
