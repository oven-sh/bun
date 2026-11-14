// Under: --aot-harden=proof-checks: every iteration of the version leaves for one as written, which enters the version again: its poll was dropped, so nothing could stop the loop, and the build stopped
function load() {
  const A = {
    Source: function Source(state) { this.state = state; this.data = null; this.onPause = null; this.onResume = null; },
    Held: function Held(source, state) { this.source = source; this.state = state; },
    Base: function Base() {},
    Other: function Other(state) { this.state = state; },
  };
  A.Source.prototype = {
    recordPause() { A.run(this.onPause); },
    recordResume() {
      if (this.state === 8) this.data.resume();
      A.run(this.onResume);
    },
  };
  A.Held.prototype = {
    paused() { this.source.recordPause(); },
    resumed() { this.source.recordResume(); },
  };
  A.Base.prototype = {
    resume() { this.guard(null); },
    guard(callback) {
      callback.call();
      this.check((this.state & 4) !== 0);
    },
    check(wasPaused) {
      let isPaused, self = this, state = self.state;
      for (;; wasPaused = isPaused) {
        if ((state & 8) !== 0) return;
        isPaused = (state & 4) !== 0;
        if (wasPaused === isPaused) return;
        self.state = state ^ 64;
        if (isPaused) self.paused(); else self.resumed();
        state = self.state & -65;
      }
    },
  };
  A.Other.prototype = {
    paused() {},
    resumed() {},
  };
  finish([A]);
  return A;
}
function finish(holders) {
  for (const holder of holders) {
    holder["r" + "un"] = callback => { if (callback != null) callback(); };
    for (const name of ["Held", "Other"]) Object.setPrototypeOf(holder[name].prototype, holder.Base.prototype);
  }
}
const A = load();
let sum = 0;
for (let i = 0; i < 200; i++) {
  const source = new A.Source(i & 7), held = new A.Held(source, i & 7), other = new A.Other(i & 7);
  let turns = 0;
  source.onPause = source.onResume = () => { if (turns++ < (i & 31)) held.state ^= 4; else held.state |= 8; };
  held.check((i & 1) !== 0);
  other.check((i & 4) !== 0);
  if (i > 900) held.resume();
  held.guard({ call() { held.state ^= i & 4; } });
  sum += held.state + turns;
}
console.log(sum);
