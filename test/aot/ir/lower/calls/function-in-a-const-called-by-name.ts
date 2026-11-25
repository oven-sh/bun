// RUN: lower
// CHECK-LABEL: function {{*}}name="onlyCalled"
// CHECK-NOT: NewClosure
// CHECK: = CallDirect {{*}}function=[[add]]
// CHECK: = CallDirect {{*}}function=[[add]]
// CHECK-NOT: NewClosure
// CHECK: function [[add]] {{*}}name="add"

// RUN(EARLY): lower
// EARLY-LABEL: function {{*}}name="run"
// EARLY-NOT: CallDirect
// EARLY: CheckInitialized
// EARLY: = Call {{*}}calleeName="filled"

// RUN(BEHIND): lower
// BEHIND-LABEL: function {{*}}name="madeEarly"
// BEHIND-NOT: NewClosure
// BEHIND: = CallDirect {{*}}function=[[run]]
// BEHIND: = NewClosure function=[[filled]]
// BEHIND: = CallDirect {{*}}function=[[run]]
// BEHIND: = CallDirect function=[[filled]]

// RUN(SWITCH): lower
// SWITCH-LABEL: function {{*}}name="jumpsOver"
// SWITCH-NOT: CallDirect
// SWITCH-LABEL: function {{*}}name="madeEarly"

// RUN(HEAD): lower
// HEAD-LABEL: function {{*}}name="headOfALoop"
// HEAD-NOT: CallDirect
// HEAD-LABEL: function {{*}}name="jumpsOver"

// `const f = (..) => ..` in a function, called by its name where the call runs behind the initialization, is entered itself; a name that nobody reads has no closure.
// A closure that is made in front of the initialization, a case that a switch can jump to, and the head of a loop, whose names each turn copies, read the name.
export function onlyCalled(a: number) {
  const add = (x: number) => x + a;
  return add(1) + add(2);
}

export function madeEarly(early: boolean) {
  const run = () => filled();
  if (early) run();
  const filled = () => 1;
  return run() + filled();
}

export function jumpsOver(k: number) {
  switch (k) {
    case 0:
      const inCase = () => 1;
      return inCase();
    default: // @ts-expect-error
      return inCase();
  }
}

export function headOfALoop() {
  let sum = 0;
  for (let i = 0, first = () => i; i < 3; i++) sum += first();
  return sum;
}
