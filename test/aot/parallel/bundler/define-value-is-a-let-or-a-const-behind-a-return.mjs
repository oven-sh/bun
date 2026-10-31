// `bun run` removes a `let` and a `const` that are declared behind a `return`, a `break` or a `continue`, so a `--define` whose value is such a name finds what lies further out. The build finds the declaration, which never runs, and stops at the defined name.
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
/* Build errors:
error: TS100050: --aot does not support --define CONST=fixed where "fixed" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'CONST="fixed"'
error: TS100050: --aot does not support --define LET=loose where "loose" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'LET="loose"'
error: TS100050: --aot does not support --define TAKEN=taken where "taken" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'TAKEN="taken"'
error: TS100050: --aot does not support --define BLOCK=inner where "inner" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'BLOCK="inner"'
error: TS100050: --aot does not support --define CLOSED=closed where "closed" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'CLOSED="closed"'
error: TS100050: --aot does not support --define KIND=kind where "kind" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'KIND="kind"'
error: TS100050: --aot does not support --define RUN=run where "run" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'RUN="run"'
error: TS100050: --aot does not support --define STORED=stored where "stored" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'STORED="stored"'
error: TS100050: --aot does not support --define CASE=chosen where "chosen" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'CASE="chosen"'
error: TS100050: --aot does not support --define LOOP=turn where "turn" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'LOOP="turn"'
error: TS100050: --aot does not support --define NEXT=step where "step" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'NEXT="step"'
*/
