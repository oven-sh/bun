let kept;
function gauge() {}
Object.defineProperty(gauge, "hook", { get: () => 1, set: value => { kept = value; } });
gauge.hook = function () { return "called"; };
console.log(kept());
