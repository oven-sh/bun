// Two classes with the same names in the same order: what is a field in one is stored over a method in the other.
class Fields { static first = 1; static second = 2; }
class BelowFields extends Fields {}
class Methods { static first() { return 1; } static second() { return 2; } }
class BelowMethods extends Methods {}
globalThis.keep = [new BelowFields(), new BelowMethods()];
function store(target, value) { target.second = value; }
function calls() { let sum = 0; for (let i = 0; i < 3000; i++) sum = (sum + Methods.second() + BelowMethods.second()) | 0; return sum; }
console.log(calls());
for (let i = 0; i < 3000; i++) store(Fields, i);
console.log(Fields.second, BelowFields.second);
store(Methods, () => 5);
console.log(calls(), Fields.second);
