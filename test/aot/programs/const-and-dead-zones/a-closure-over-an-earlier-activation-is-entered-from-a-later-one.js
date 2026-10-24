// An environment of an earlier activation, entered from a later one.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
let saved;
function outer(depth) {
  const read = () => v.a;
  if (depth === 0) { saved = read; outer(1); }
  var v = { a: depth };
  if (depth === 1) console.log(attempt(saved));
  return read();
}
console.log(outer(0));
function loop() {
  const all = [];
  for (let i = 0; i < 2; i++) {
    all.push(() => w.a);
    if (i === 1) console.log(attempt(all[1]), attempt(all[0]));
    let w = { a: i };
  }
}
loop();
