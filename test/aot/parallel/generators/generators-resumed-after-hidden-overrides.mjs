// STATISTIC: GeneratorFramesBuilt >= 14
// A loop over a generator runs code that it does not see called (a getter, a conversion, a proxy, an iterator), and that code overrides the return that closes the generator.
const notes = [];
let closed = 0;
const pick = name => (notes.length < 0 ? "" : name);
function* counts(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { closed++; notes.push("closed " + limit); } }
function* plain(limit) { for (let i = 0; i < limit; i++) yield i; }
function* several(limit, text = "t") {
  let real = limit / 4;
  const parts = [text], later = [];
  for (let i = 0; i < limit; i++) {
    const own = { i, real };
    later.push(() => own.i + real);
    try {
      const got = yield i;
      parts.push(got ?? own.real);
      if (i & 1) parts.push(yield { i, text: text + i });
    } catch (error) {
      notes.push("caught " + error.message);
      yield "after " + parts.join();
    } finally {
      real += 0.5;
      notes.push("finally " + i + " " + later.map(each => each()).join());
      if (i === 2) yield "late " + BigInt(i);
    }
  }
  return parts;
}
class Source {
  tag = "source";
  *items(limit) { try { let previous = null; for (let i = 0; i < limit; i++) { const next = { i, previous, tag: this.tag }; yield next.i; previous = next; } } finally { notes.push("left " + this.tag); } }
}
const source = new Source();
const makers = { counts: n => counts(n), plain: n => plain(n), several: n => several(n), items: n => source.items(n) };
console.log(Object.values(makers).map(make => JSON.stringify(make(2).next())).join());
const functions = [counts, plain, several, Source.prototype.items];
const engines = Object.getPrototypeOf(counts.prototype);
const kept = [];
const show = value => JSON.stringify(value);
const overrides = {
  leaves(value) { notes.push("own"); const result = engines.return.call(this, value); notes.push(show(result)); return result; },
  steps(value) { notes.push(show(engines.next.call(this, 8)), show(engines.next.call(this, 9))); return engines.return.call(this, value); },
  throws() { try { notes.push(show(engines.throw.call(this, new Error("into")))); } catch (error) { notes.push(error.message); } kept.push(this); return {}; },
  keeps() { kept.push(this); return {}; },
  drains() { notes.push([...{ [Symbol.iterator]: () => ({ next: () => engines.next.call(this) }) }].map(show).join()); return {}; },
};
function* ticks(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { closed++; } }
class Clock { *ticks(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { closed += 2; } } }
const clock = new Clock();
functions.push(ticks, Clock.prototype.ticks);
console.log(ticks(1).next().value, clock.ticks(1).next().value);
const ofTicks = ticks.prototype, ofClock = Clock.prototype.ticks.prototype, ofCounts = counts.prototype, ofPlain = plain.prototype, ofSeveral = several.prototype, ofItems = Source.prototype.items.prototype;
let override = null;
const define = () => { for (const prototype of [ofTicks, ofClock, ofCounts, ofPlain, ofSeveral, ofItems]) prototype[pick("return")] = override; return 1; };
const restore = () => { for (const prototype of [ofTicks, ofClock, ofCounts, ofPlain, ofSeveral, ofItems]) delete prototype[pick("return")]; };
const got = { get value() { return define(); } };
const valued = { valueOf() { return define(); } };
const texted = { toString() { define(); return "key"; } };
const trapped = new Proxy({}, { get() { return define(); }, has() { define(); return true; } });
const stepped = { [Symbol.iterator]() { let turn = 0; return { next() { define(); return { done: turn++ > 0, value: 1 }; } }; } };
class Made { constructor() { define(); } }
const holder = {};
function byGetter() { let n = 0; for (const v of ticks(5)) { n += got.value; if (v === 2) break; } return n; }
function byValueOf() { let n = 0; for (const v of clock.ticks(5)) { n += +valued; if (v === 2) break; } return n; }
function byCompare() { let n = 0; for (const v of ticks(5)) { if (valued > n) n++; if (v === 2) return n; } return -1; }
function byKey() { let n = 0; for (const v of clock.ticks(5)) { holder[texted] = v; if (++n === 2) throw new RangeError("out"); } return n; }
function byProxy() { let n = 0; for (const v of ticks(5)) { n += trapped.x; if (v === 2) break; } return n; }
function byHas() { let n = 0; for (const v of ticks(5)) { if ("x" in trapped) n++; if (v === 1) return n; } return -1; }
function bySteps() { let n = 0; outer: for (let turn = 0; turn < 2; turn++) for (const v of ticks(4)) { for (const w of stepped) n += w; if (n > 1) continue outer; } return n; }
function bySuper() { let n = 0; for (const v of ticks(5)) { n += new (class extends Made {})() ? 1 : 0; if (v === 2) break; } return n; }
function byMax() { let n = 0; for (const v of ticks(5)) { n += Math.max(valued, v); if (v === 2) break; } return n; }
function atFirst() { let n = 0; for (const v of plain(5)) { n += got.value; break; } return n; }
function drain(it) { let n = 0; for (const v of it) { n += got.value; if (v === 2) break; } return n; }
function byPassing() { return drain(ticks(5)) + drain(ticks(4)); }
function ofNotes() { let n = 0; for (const v of counts(5)) { n += got.value; if (v === 2) break; } return n; }
function ofSeveralYields() { let n = 0; for (const v of several(5)) { n += got.value; if (n === 4) break; } return n; }
function ofFields() { let n = 0; for (const v of source.items(5)) { n += +valued; if (v === 3) break; } return n; }
const loops = { byGetter, byValueOf, byCompare, byKey, byProxy, byHas, bySteps, bySuper, byMax, atFirst, byPassing, ofNotes, ofSeveralYields, ofFields };
for (let turn = 0; turn < 2; turn++) {
  for (const [name, method] of Object.entries(overrides)) {
    for (const [loop, run] of Object.entries(loops)) {
      override = method;
      let answer;
      try { answer = run(); } catch (error) { answer = error.message; }
      restore();
      console.log(name, loop, answer, closed, notes.splice(0).join("; "));
      for (const generator of kept.splice(0)) {
        if (turn) Bun.gc(true);
        const steps = [generator.next(1), generator.next(2), generator.next(3)].map(show);
        try { steps.push(show(generator.throw(new Error("late")))); } catch (error) { steps.push(error.message); }
        console.log("later", steps.join(), show(generator.return(4)), show(generator.next()), closed, notes.splice(0).join("; "));
      }
    }
  }
}
