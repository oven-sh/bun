// A `--define` whose value is the name of an enum that a function declares behind a `return`, a `break` or a `throw`, or a path below it, names that enum: in front of the declaration the read throws a ReferenceError. `bun run` removes the enum and finds what lies further out. Plain Bun prints another output.
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
/* Output:
ReferenceError ReferenceError ReferenceError ReferenceError ReferenceError ReferenceError
*/
