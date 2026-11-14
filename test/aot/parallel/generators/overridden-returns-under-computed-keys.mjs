// A loop over a generator runs a return of the program that was defined inside of the loop under a computed key and that resumes the generator.
const notes = [];
const pick = name => notes.length < 0 ? "" : name;
function* steps(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { notes.push("finally"); } }
function* plain(limit) { for (let i = 0; i < limit; i++) yield i; }
class Source { *steps(limit) { try { yield* [4, 5, 6, limit]; } finally { notes.push("finally of"); yield "late"; } } }
const source = new Source();
console.log(steps(1).next().value, plain(1).next().value, source.steps(1).next().value);
const inherited = Object.getPrototypeOf(steps.prototype);
const returns = inherited.return, throws = inherited.throw;
let kept = null;
const leaves = function (value) { notes.push("own"); const result = returns.call(this, value); notes.push(JSON.stringify(result)); return result; };
const overrides = {
  leaves,
  leavesTwice(value) { leaves.call(this, 1); return leaves.call(this, value); },
  steps(value) { notes.push(JSON.stringify(this.next()), JSON.stringify(this.next())); return { value }; },
  throws(value) { try { notes.push(JSON.stringify(throws.call(this, new Error("thrown")))); } catch (error) { notes.push(error.message); } return { value }; },
  keeps(value) { kept = this; return { value }; },
};
const define = (prototype, method) => { prototype[pick("return")] = method; };
function drain(it, prototype, method) { let sum = 0; for (const v of it) { sum += v; if (method) define(prototype, method); if (v === 2 || v === 6) break; } return sum; }
const loops = {
  call(method) { let sum = 0; for (const v of steps(5)) { sum += v; steps.prototype[pick("return")] = method; if (v === 2) break; } return sum; },
  withoutTry(method) { let sum = 0; for (const v of plain(5)) { sum += v; plain.prototype[pick("return")] = method; if (v === 2) return sum; } return -1; },
  method(method) { let sum = 0; for (const v of source.steps(7)) { sum += v; define(Source.prototype.steps.prototype, method); if (v === 6) break; } return sum; },
  passed(method) { return drain(steps(5), steps.prototype, null) + drain(steps(4), steps.prototype, method); },
  thrown(method) { let sum = 0; for (const v of steps(5)) { sum += v; define(steps.prototype, method); if (v === 1) throw new RangeError("out " + sum); } return sum; },
  labelled(method) { let sum = 0; outer: for (let turn = 0; turn < 2; turn++) for (const v of steps(4)) { sum += v; if (turn) define(steps.prototype, method); if (v === 1) continue outer; } return sum; },
  toTheEnd(method) { let sum = 0; for (const v of steps(3)) { sum += v; define(steps.prototype, method); } return sum; },
};
for (let turn = 0; turn < 2; turn++) {
  for (const [name, loop] of Object.entries(loops)) {
    for (const [override, method] of Object.entries(overrides)) {
      let answer;
      try { answer = loop(method); } catch (error) { answer = error.message; }
      console.log(name, override, answer, notes.join(" "));
      notes.length = 0;
      for (const function_ of [steps, plain, Source.prototype.steps]) delete function_.prototype[pick("return")];
      if (kept) console.log([...kept].join(), notes.join(" "));
      kept = null;
      notes.length = 0;
    }
  }
}
