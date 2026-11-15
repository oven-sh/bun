// STATISTIC: GeneratorFramesBuilt >= 12
// Hidden code overrides the return of a generator while a loop runs it, and the override resumes the generator with everything that is live at its yield. Every experiment has generators of its own.
const notes = [];
const show = value => JSON.stringify(value, (key, each) => (typeof each === "bigint" ? each + "n" : each === undefined ? "undefined" : each));
const pick = name => (notes.length < 0 ? "" : name);
const engines = Object.getPrototypeOf(Object.getPrototypeOf((function* () {})()));
const kept = [];
const overrides = {
  leaves(value) { const result = engines.return.call(this, value); notes.push(show(result)); return result; },
  steps(value) { notes.push(show(engines.next.call(this, 8)), show(engines.next.call(this, 9))); return engines.return.call(this, value); },
  throws() { try { notes.push(show(engines.throw.call(this, new Error("into")))); } catch (error) { notes.push(error.message); } kept.push(this); return {}; },
  keeps() { kept.push(this); return {}; },
  drains() { for (let step = engines.next.call(this, 0), count = 0; !step.done && count < 9; step = engines.next.call(this, ++count)) notes.push(show(step.value)); return {}; },
};
let override = null;
let total = 0;
function experiment(which) {
  function* values(limit, text) {
    let real = limit / 4, big = 2n ** 65n, flag = limit > 2, nothing = null, missing;
    const list = [limit], record = { limit, text };
    for (let i = 0; i < limit; i++) {
      const got = yield i;
      real += 0.25; big += 1n; flag = !flag; list.push(got); record.limit += i;
      if (i === 1) { missing = text + real; nothing = list; }
    }
    return [real, big + "", flag, nothing && nothing.length, missing, list, record];
  }
  function* yields(limit) {
    let sum = limit;
    sum += yield "first";
    try { sum += yield "second " + sum; } catch (error) { sum = yield "caught " + error.message + sum; } finally { total += sum | 0; yield "finally " + sum; }
    switch (limit) { case 5: sum += yield "five"; case 6: sum += yield "six " + sum; break; default: yield "none"; }
    for (let outer = 0; outer < 2; outer++) { for (let inner = 0; inner < 2; inner++) { if (inner === outer) continue; sum += yield outer * 10 + inner; } }
    return sum;
  }
  function* scopes(limit) {
    const each = [];
    let shared = 0;
    const add = amount => { shared += amount; total += amount; return shared; };
    for (let i = 0; i < limit; i++) {
      each.push(() => i + shared);
      const got = yield add(i);
      if (got) { let own = got * 2; each.push(() => own++); }
    }
    return each.map(one => one()).concat(each.map(one => one()));
  }
  class Source {
    tag = "source"; #hidden = 7;
    *items(limit, ...rest) { let previous = null; try { for (let i = 0; i < limit; i++) { const next = { i, previous, tag: this.tag, hidden: this.#hidden++ }; const got = yield next.i; if (got === 9) this.tag += got; previous = next; } } finally { notes.push("left " + this.tag + rest); } return previous; }
  }
  const source = new Source();
  const prototypes = [values, yields, scopes, Source.prototype.items].map(each => each.prototype);
  console.log(values(1, "").next().value, yields(1).next().value, scopes(1).next().value, source.items(1).next().value);
  const define = () => { for (const prototype of prototypes) prototype[pick("return")] = override; return 1; };
  const got = { get value() { return define(); } };
  const valued = { valueOf() { return define(); } };
  const trapped = new Proxy({}, { get() { return define(); } });
  const stepped = { [Symbol.iterator]() { let turn = 0; return { next() { define(); return { done: turn++ > 0, value: 1 }; } }; } };
  const loops = {
    valuesByGetter() { let n = 0; for (const v of values(6, "t")) { n += got.value; if (v === 2) break; } return n; },
    valuesAtFirst() { let n = 0; for (const v of values(4, "u")) { n += +valued; return n + v; } return -1; },
    yieldsByProxy() { let n = 0; for (const v of yields(5)) { n += trapped.x; if (n === which + 1) break; } return n; },
    yieldsBySteps() { let n = 0; for (const v of yields(6)) { for (const w of stepped) n += w; if (n > which) throw new RangeError("out " + v); } return n; },
    scopesByGetter() { let n = 0; for (const v of scopes(5)) { n += got.value; if (n === 3) break; } return n; },
    itemsByValueOf() { let n = 0; for (const v of source.items(5, 1, "r")) { n += +valued; if (v === 2) return n; } return -1; },
    passed() { const drain = it => { let n = 0; for (const v of it) { n += got.value; if (n === 2) break; } return n; }; return drain(values(5, "p")); },
  };
  return loops;
}
for (let which = 0; which < 9; which++) {
  for (const name of Object.keys(overrides)) {
    for (const loop of Object.keys(experiment(0))) {
      const run = experiment(which)[loop];
      override = overrides[name];
      let answer;
      try { answer = run(); } catch (error) { answer = error.message; }
      console.log(which, name, loop, answer, total, notes.splice(0).join("; "));
      for (const generator of kept.splice(0)) {
        const steps = [];
        for (let count = 1; count < 5; count++) { if (which & 1) Bun.gc(true); steps.push(show(engines.next.call(generator, count))); }
        try { steps.push(show(engines.throw.call(generator, new Error("late")))); } catch (error) { steps.push(error.message); }
        console.log("later", steps.join(), show(engines.return.call(generator, 4)), show(engines.next.call(generator)), total, notes.splice(0).join("; "));
      }
    }
  }
  if (which > 1) which++;
}
