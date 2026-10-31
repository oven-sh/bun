// `bun run` removes an enum of a function behind a `return`, a `break` or a `throw`, so a `--define` whose value is the name of the enum, or a path below it, finds what lies further out. The build finds the enum, which is never made, and stops at the defined name.
// Flags: --define RETURNED=kind --define CONSTANT=fixed --define BROKEN=turn --define THROWN=raised --define MEMBER=shade.Dark --define AGAIN=twice
declare const RETURNED: unknown, CONSTANT: unknown, BROKEN: unknown, THROWN: unknown, MEMBER: unknown, AGAIN: unknown;
for (const name of ["kind", "fixed", "turn", "raised", "shade", "twice"]) {
  (globalThis as any)[name] = "the global";
}
function attempt(read: () => unknown): unknown {
  try {
    return read();
  } catch (error: any) {
    return typeof error === "string" ? error : error.constructor.name;
  }
}
function behindAReturn() {
  return RETURNED;
  enum kind {
    A,
  }
}
function ofAConstEnum() {
  return CONSTANT;
  const enum fixed {
    A,
  }
}
function behindABreak(on: boolean) {
  let seen: unknown;
  while (on) {
    seen = BROKEN;
    break;
    enum turn {
      A,
    }
  }
  return seen;
}
function behindAThrow() {
  throw THROWN;
  enum raised {
    A,
  }
}
function belowTheEnum() {
  return String(MEMBER);
  enum shade {
    Dark,
  }
}
function declaredTwice() {
  return AGAIN;
  enum twice {
    A,
  }
  enum twice {
    B = 1,
  }
}
console.log(
  attempt(behindAReturn),
  attempt(ofAConstEnum),
  attempt(() => behindABreak(true)),
  attempt(behindAThrow),
  attempt(belowTheEnum),
  attempt(declaredTwice),
);
export {};
/* Build errors:
error: TS100050: --aot does not support --define RETURNED=kind where "kind" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'RETURNED="kind"'
error: TS100050: --aot does not support --define CONSTANT=fixed where "fixed" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'CONSTANT="fixed"'
error: TS100050: --aot does not support --define BROKEN=turn where "turn" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'BROKEN="turn"'
error: TS100050: --aot does not support --define THROWN=raised where "raised" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'THROWN="raised"'
error: TS100050: --aot does not support --define MEMBER=shade.Dark where "shade" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'MEMBER="shade.Dark"'
error: TS100050: --aot does not support --define AGAIN=twice where "twice" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'AGAIN="twice"'
*/
