function hide(...fns) { for (const fn of fns) Object.defineProperty(fn, "name", { value: "hidden" }); }
function one() { return 1; }
function two() { return 2; }
hide(one, two);
console.log(one.name, two.name, one(), two());
try { hide(undefined); } catch (error) { console.log(error.name); }
