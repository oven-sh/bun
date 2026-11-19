// An async generator whose values live across yields and awaits is stepped, thrown into, returned into, left by break, and met by awaits that reject at each step in turn.
// Under: --aot-check=Validate: behind each suspension the body names anew what it reads out of its frame in the heap; a compiler that checks itself looks at every such name
// Under: --aot-testing=CheckEffectsAtRunTime --aot-check=Validate: the net of effects read the operands of a suspension in front of the call that throws what was thrown into it, behind an entrypoint, where they have no names
const out = [];
const say = (...parts) => out.push(parts.map(part => typeof part === "object" && part !== null ? JSON.stringify(part) : String(part)).join(" "));
const later = value => new Promise(resolve => setTimeout(resolve, 0, value));
const soon = value => new Promise(resolve => queueMicrotask(() => resolve(value)));

async function* counted(label, limit, fails) {
  let total = 0.5, text = label, big = 10n, list = [label], record = { label, seen: 0 };
  const add = step => { total += step; record.seen++; return total; };
  try {
    for (let i = 0; i < limit; i++) {
      const awaited = await (fails === i ? Promise.reject(new Error(label + " rejects at " + i)) : i % 3 === 0 ? later(i) : i % 3 === 1 ? soon(i) : i);
      text += awaited; big += BigInt(i); list.push(i);
      let sent;
      try {
        sent = yield { i, total: add(awaited), text, big: String(big), length: list.length };
      } catch (error) {
        say(label, "caught inside", error && error.message || error, i, text);
        sent = yield "after catch " + i;
      } finally {
        record.last = i;
      }
      if (sent === "stop") return { label, total, text, record };
      if (sent !== undefined) text += "<" + sent + ">";
    }
    return { label, total, text, big: String(big), list, record };
  } finally {
    say(label, "outer finally", total, text, record);
    await soon(0);
    say(label, "behind the await in finally", list.length);
  }
}

async function settle(label, promise) {
  try { say(label, await promise); } catch (error) { say(label, "rejected", error && error.message || error); }
}

async function main() {
  let it = counted("plain", 4, -1);
  for (const sent of [undefined, "a", undefined, "b", "c", "d"]) await settle("next", it.next(sent));

  for (let at = 0; at < 4; at++) {
    it = counted("thrown" + at, 5, -1);
    for (let i = 0; i < at; i++) await settle("step", it.next());
    await settle("throw", it.throw(new Error("from outside " + at)));
    await settle("behind throw", it.next("x"));
    await settle("second throw", it.throw("bare"));
    await settle("end", it.next());
  }
  for (let at = 0; at < 4; at++) {
    it = counted("returned" + at, 5, -1);
    for (let i = 0; i < at; i++) await settle("step", it.next());
    await settle("return", it.return({ given: at }));
    await settle("behind return", it.next());
  }
  for (let fails = 0; fails < 5; fails++) {
    it = counted("fails" + fails, 4, fails);
    for (let i = 0; i < 6; i++) await settle("step " + i, it.next(i));
  }
  for (const way of ["break", "return", "throw", "whole"]) {
    await settle("loop " + way, (async () => {
      let sum = 0;
      for await (const step of counted("loop-" + way, 4, -1)) {
        sum += step.total;
        if (step.i === 2) { if (way === "break") break; if (way === "return") return "left " + sum; if (way === "throw") throw new Error("out of the loop " + sum); }
      }
      return sum;
    })());
  }
  it = counted("queued", 4, -1);
  await Promise.all([it.next("q0"), it.next("q1"), it.next("stop"), it.next("q3"), it.return("q4"), it.throw(new Error("q5"))].map((promise, index) => settle("queued " + index, promise)));

  async function* through(inner, label) { let n = 0; try { for await (const x of inner) { n++; yield [label, n, x.i ?? x]; } } finally { say(label, "left after", n); } return label; }
  async function* delegating(label) { const first = yield* through(counted(label + "-a", 2, -1), label + "-t"); say(label, "first", first); const second = yield* [1, soon(2), 3]; say(label, "second", second); return yield* counted(label + "-b", 1, -1); }
  it = delegating("star");
  for (let i = 0; i < 9; i++) await settle("star " + i, it.next(i));
  it = delegating("star-thrown");
  await settle("s", it.next()); await settle("s", it.throw(new Error("into the star"))); await settle("s", it.next()); await settle("s", it.return("enough")); await settle("s", it.next());

  let chain = counted("deep", 3, -1);
  for (let level = 0; level < 12; level++) chain = through(chain, "l" + level);
  for await (const x of chain) say("deep", x);

  const self = (async function* () { say("self", "in"); const again = self.next("while running"); again.then(step => say("self again", step)); const sent = yield 1; say("self sent", sent); yield 2; })();
  await settle("self 0", self.next()); await settle("self 1", self.next()); await settle("self 2", self.next());
}
await main();
console.log(out.length); console.log(out.join("\n"));
