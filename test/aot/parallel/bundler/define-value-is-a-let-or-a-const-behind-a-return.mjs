// A `--define` whose value is the name of a `let` or a `const` that is declared behind a `return`, a `break` or a `continue` names that variable: in front of the declaration a read, a call, `typeof` and a store throw a ReferenceError, as they do for the name written there. `bun run` removes the declaration and finds what lies further out. Plain Bun prints another output.
// Flags: --define CONST=fixed --define LET=loose --define TAKEN=taken --define BLOCK=inner --define CLOSED=closed --define KIND=kind --define RUN=run --define STORED=stored --define CASE=chosen --define LOOP=turn --define NEXT=step
for (const name of ["fixed", "loose", "taken", "inner", "closed", "kind", "stored", "chosen", "turn", "step"]) {
  globalThis[name] = "the global";
}
globalThis.run = () => "the global";
function attempt(read) {
  try {
    return read();
  } catch (error) {
    return error.constructor.name;
  }
}
function ofAConst() {
  return CONST;
  const fixed = 1;
}
function ofALet() {
  return LET;
  let loose = 1;
}
function behindATest() {
  if (true) return TAKEN;
  const taken = 1;
}
function inABlock(on) {
  if (on) {
    return BLOCK;
    const inner = 1;
  }
}
function byAClosure() {
  const read = () => CLOSED;
  return read();
  const closed = 1;
}
function underTypeof() {
  return typeof KIND;
  const kind = 1;
}
function called() {
  return RUN();
  const run = 1;
}
function storedTo() {
  STORED = "stored";
  return globalThis.stored;
  let stored = 1;
}
function inACase(pick) {
  switch (pick) {
    case 1:
      return CASE;
      const chosen = 1;
  }
}
function behindABreak(on) {
  let seen;
  while (on) {
    seen = LOOP;
    break;
    let turn = 1;
  }
  return seen;
}
function behindAContinue() {
  let seen;
  for (const round of [1]) {
    seen = NEXT;
    continue;
    let step = round;
  }
  return seen;
}
console.log(
  attempt(ofAConst),
  attempt(ofALet),
  attempt(behindATest),
  attempt(() => inABlock(true)),
  attempt(byAClosure),
  attempt(underTypeof),
  attempt(called),
  attempt(storedTo),
  attempt(() => inACase(1)),
  attempt(() => behindABreak(true)),
  attempt(behindAContinue),
);
/* Output:
ReferenceError ReferenceError ReferenceError ReferenceError ReferenceError ReferenceError ReferenceError ReferenceError ReferenceError ReferenceError ReferenceError
*/
