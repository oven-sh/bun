// The text that is kept for a function lacks the branches of statements that `bun build` removes: a branch that never runs is empty, and an `else` that never runs is gone. The layout is the source's own, so the text is printed without its white space.
// Reference: bun build --compile
function dead(): number {
  return 1;
}
function shown(o: any): unknown {
  if (false) dead();
  if (false) {
    dead();
    if (o.a) dead();
    else dead();
  }
  if (false) dead();
  else o.a;
  if (true) o.b;
  else dead();
  if (true) {
    o.c;
  } else {
    dead();
  }
  if (o.d) {
    if (false) dead();
    else if (true) o.e;
    else dead();
  }
  return o.f;
}
console.log(shown.toString().replace(/\s+/g, ""));
console.log(String((0, eval)("(" + shown.toString() + ")")({ f: "evaluated again" })));
