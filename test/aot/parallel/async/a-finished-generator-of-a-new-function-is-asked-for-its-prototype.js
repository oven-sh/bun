// A generator of a function that nobody has asked for its `prototype` finds the function in its heap frame, so the frame must still be there when the generator has run to its end, was returned from or thrown into.
const hide = (0, eval)("x => x // ".slice(0, process.argv.length > 1000 ? 1 : 6));
function make(tag) {
  return hide(function* () {
    const sent = yield tag + 1;
    return sent;
  });
}
const out = [];
function ask(what, f, g) {
  out.push(what + ": " + [Object.getPrototypeOf(g) === f.prototype, g instanceof f, Object.getPrototypeOf(Object.getPrototypeOf(g)) === Object.getPrototypeOf(function* () {}).prototype]);
}
for (let round = 0; round < 3; round++) {
  {
    const f = make("a"), g = hide(f());
    g.next(); g.next(1); g.next();
    ask("run to its end", f, g);
  }
  {
    const f = make("b"), g = hide(f());
    g.return(5);
    ask("returned before its start", f, g);
  }
  {
    const f = make("c"), g = hide(f());
    try { g.throw(new Error("x")); } catch {}
    ask("thrown into before its start", f, g);
  }
  {
    const f = make("d"), g = hide(f());
    g.next(); g.return(7);
    ask("returned at a yield", f, g);
  }
  {
    const f = make("e"), g = hide(f());
    [...g];
    if (typeof Bun !== "undefined") Bun.gc(true);
    ask("spread, then a collection", f, g);
  }
  {
    const f = make("f"), done = hide(f()), other = make("g"), kept = hide(other());
    [...done];
    other.prototype.extra = round;
    out.push("a change with a finished one alive: " + [kept.extra, done.extra, Object.getPrototypeOf(done) === f.prototype]);
  }
}
console.log(out.join("\n"));
