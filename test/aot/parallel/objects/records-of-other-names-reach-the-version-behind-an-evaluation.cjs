// STATISTIC: SlowBodiesToldWhatCopiesHandThem >= 1
// Under: --aot-harden=proof-checks: what is said to arrive arrives
// Under: --aot-testing=FailSpeculations: whatever is asked in front may fail
// Under: --aot-testing=CheckEffectsAtRunTime: nothing runs between a guard and the call
// Under: --aot-erase-types: nothing but the calls tells
// A file that evaluates a text: a function that is handed its one literal by a call, and by a loop's copy what has its names in other places.
let scale = 10;
function run(code) { return eval(code); }
const made = (() => {
  function area(p) { const w = p.a * scale + p.b; return w * 3 + p.a; }
  const first = area({ a: 4, b: 5 });
  function one(p) { let s = 0; for (let k = 0; k < 3; k++) s += area(p); return s; }
  return { one, first };
})();
const names = JSON.parse('["b","a","c","d"]'), odd = {};
for (let k = 0; k < 4; k++) odd[names[k]] = k + 3;
console.log(made.first, made.one(odd), run("1 + 1"));
console.log(made.one(odd), made.one({ a: 1, b: 2 }), run("scale = 7"), made.one(odd));
