function* steps() { yield 1; }
const arrow = () => 1;
const holder = { method() { return 1; } };
async function later() { return 1; }
steps.prototype = null; arrow.prototype = null; holder.method.prototype = 7; later.prototype = true;
function tell(p) { let out = ""; for (let i = 0; i < 300; i++) out = p === null ? "null" : typeof p; return out; }
console.log(tell(steps.prototype), tell(arrow.prototype), tell(holder.method.prototype), tell(later.prototype), steps().next().value);
