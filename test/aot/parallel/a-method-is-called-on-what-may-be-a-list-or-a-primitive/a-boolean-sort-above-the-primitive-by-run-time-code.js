// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: a list that stays in sight though code nobody has seen got it as `this` shows first as a false proof about a field of its rows
let calls = 0;
class Row { constructor(a) { this.a = a; } }
const list = [new Row(1), new Row(2), new Row(3)];
const held = new Map([["list", list], ["other", true]]);
function sum() { let s = 0; for (let i = 0; i < list.length; i++) s = s + list[i].a; return s; }
function attempt(x) { try { return typeof x.sort((p, q) => p.a - q.a); } catch (error) { return error.name; } }
new Function("spoil", "Boolean.prototype.sort = spoil;")(function () { calls++; if (typeof this === "object" && this !== null && this[0]) this[0].a = "text"; return 0; });
let said = "";
for (let t = 0; t < 40; t++) for (const key of ["list", "other"]) said = attempt(held.get(key)) + "," + sum();
console.log(said, typeof sum(), calls);
