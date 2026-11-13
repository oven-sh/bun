// What generators inherit is changed while a loop over one runs, under names made at run time too: the loop is left by what its own generator inherits.
const notes = [];
const pick = name => notes.length < 0 ? "" : name;
const own = text => function () { notes.push(text, Object.getPrototypeOf(this) === first || "other", Object.keys(this).length); return {}; };
function* steps(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { notes.push("finally"); } }
function* other() { }
class Source { *steps(limit) { for (let i = 0; i < limit; i++) yield i; } }
const source = new Source(), ofSource = Source.prototype.steps;
const first = steps.prototype, above = Object.getPrototypeOf(first), plain = other.prototype;
const made = [steps(1), steps(2), source.steps(3)].map(each => each.next().value);
console.log(made.join());

function put() { first[pick("return")] = own("put"); }
function drain(it) { let n = 0; for (const v of it) { put(); if (++n === 2) break; } return n; }
function drainUnseen(it, act) { let n = 0; for (const v of it) { act(n); if (++n === 2) return n; } return -n; }
const ways = {
  computed() { let n = 0; for (const v of steps(3)) { first[pick("return")] = own("computed"); if (++n === 2) break; } return n; },
  replaced() { let n = 0; for (const v of steps(3)) { first[pick("return")] = own("replaced"); steps.prototype = plain; notes.push(steps(1).next().value); if (++n === 2) break; } return n; },
  replacedAlone() { let n = 0; for (const v of steps(3)) { steps.prototype = { return() { notes.push("wrong"); return {}; } }; if (++n === 2) break; } return n; },
  ofMethod() { let n = 0; for (const v of source.steps(3)) { ofSource.prototype = plain; notes.push(source.steps(1).next().value); if (++n === 2) break; } return n; },
  passed() { return drain(steps(3)) + drain(steps(4)); },
  passedUnseen() { return drainUnseen(steps(3), n => { if (n) first[pick("return")] = own("unseen"); }); },
  extra() { let n = 0; for (const v of steps(3)) { first[pick("extra")] = n; if (++n === 2) break; } return n; },
  getter() { let n = 0; for (const v of steps(3)) { Object.defineProperty(first, pick("return"), { configurable: true, get() { notes.push("get"); return own("got"); } }); if (++n === 2) return n; } return -1; },
  none() { let n = 0; for (const v of steps(3)) { first[pick("return")] = undefined; if (++n === 2) break; } return n; },
  noObject() { let n = 0; for (const v of steps(3)) { first[pick("return")] = () => 5; if (++n === 2) break; } return n; },
  noFunction() { let n = 0; for (const v of steps(3)) { first[pick("return")] = 5; if (++n === 2) break; } return n; },
  throws() { let n = 0; for (const v of steps(3)) { first[pick("return")] = () => { throw new Error("own"); }; if (++n === 2) break; } return n; },
  thrown() { let n = 0; for (const v of steps(3)) { first[pick("return")] = () => { notes.push("dropped"); throw new Error("own"); }; if (++n === 2) throw new Error("out"); } return n; },
  linked() { let n = 0; for (const v of steps(3)) { Object.setPrototypeOf(first, { __proto__: above, [pick("return")]: own("linked") }); if (++n === 2) break; } return n; },
  unlinked() { let n = 0; for (const v of steps(3)) { Object.setPrototypeOf(first, null); if (++n === 2) break; } return n; },
  pattern() { const [a, b = (first[pick("return")] = own("pattern"), 7)] = steps(1); return a + b; },
  whole() { let n = 0; for (const v of steps(3)) { first[pick("return")] = own("whole"); n += v; } return n; },
};
for (let turn = 0; turn < 3; turn++) {
  for (const [name, run] of Object.entries(ways)) {
    let answer;
    try { answer = run(); } catch (error) { answer = error.message; }
    console.log(name, answer, notes.join());
    notes.length = 0;
    delete first[pick("return")];
    delete first.extra;
    Object.setPrototypeOf(first, above);
    steps.prototype = first;
    ofSource.prototype = Object.create(above);
    steps(1).next();
    source.steps(1).next();
  }
}
