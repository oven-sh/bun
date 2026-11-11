// What the callee gets is a list of its own: its length, who else has it, a store into it, and `arguments` beside it in the caller and in the callee.
// The callers are read out of a table under a key that only the run knows, so each is entered by value and its own body runs.
class Taker {
  count = 0;
  give(a, b, ...rest) { this.count++; return rest; }
  measure(a, b, ...rest) { this.count++; return rest.length + ":" + arguments.length + ":" + (arguments[2] === rest[0]); }
  store(a, b, ...rest) { this.count++; rest[0] = "stored"; rest.length = 1; return rest.join(); }
}
function wrap(taker) {
  return {
    gives(...values) { return taker.give(1, 2, ...values); },
    same(...values) { const got = taker.give(1, 2, ...values); return got === values; },
    sameByStore(...values) { const got = taker.give(1, 2, ...values); got[0] = "theirs"; return values[0]; },
    measures(...values) { return taker.measure(1, 2, ...values); },
    stores(...values) { return taker.store(1, 2, ...values); },
    storesAndReads(...values) { const out = taker.store(1, 2, ...values); return out + "|" + values.join() + "|" + values.length; },
    besideArguments(...values) { const all = arguments; const out = taker.store(1, 2, ...values); return out + "|" + all.length + "|" + all[0] + "|" + Array.prototype.join.call(all); },
    lengthFirst(...values) { const n = values.length; return n + ":" + taker.give(1, 2, ...values).length; },
  };
}
const table = wrap(new Taker());
const names = Object.keys(table);
let last = "";
for (let i = 0; i < 300; i++) {
  const out = [];
  for (const name of names) {
    const caller = table[name];
    out.push(name + "=" + String(caller(i, "x")) + "/" + String(caller()));
  }
  last = out.join(" ");
}
console.log(last);
const gives = table[names[0]];
const first = gives(1, "x"), second = gives(1, "x"), none = gives();
first.push("more");
first[5] = "far";
console.log(first !== second, first.join(), second.join(), first.length, second.length, none.length, Array.isArray(none), Object.getPrototypeOf(none) === Array.prototype, 3 in first, Object.keys(second).join(), JSON.stringify(Object.getOwnPropertyDescriptor(second, "length")));
