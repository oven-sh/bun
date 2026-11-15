// A helper's store runs where the helper is handed `this`, but only where the helper's own body always evaluates it. On an arm, in a loop, behind a return or in a closure of the helper it decides nothing: the constructor's own store behind the call makes the field.
// RUN(ARM): link
// ARM: layout {{*}}kind=Instance name="OnAnArm" {{*}}fields=[{key="mark" {{*}}flags=[IsRequired]}, {key="size"
// RUN(RETURN): link
// RETURN: layout {{*}}kind=Instance name="BehindAReturn" {{*}}fields=[{key="mark" {{*}}flags=[IsRequired]}, {key="size"
// RUN(LOOP): link
// LOOP: layout {{*}}kind=Instance name="InALoop" {{*}}fields=[{key="mark" {{*}}flags=[IsRequired]}, {key="size"
// RUN(CLOSURE): link
// CLOSURE: layout {{*}}kind=Instance name="InAClosure" {{*}}fields=[{key="mark" {{*}}flags=[IsRequired]}, {key="size"
// RUN(MAYBE): link
// MAYBE: layout {{*}}kind=Instance name="MayBeThis" {{*}}fields=[{key="mark" {{*}}flags=[IsRequired]}, {key="size"
// RUN(STRAIGHT): link
// STRAIGHT: layout {{*}}kind=Instance name="Straight" {{*}}key="mark" {{*}}flags=[IsRequired] form=[IsNotEnumerable]
// RUN(REVERSE): link
// REVERSE: layout {{*}}kind=Instance name="Reverse" {{*}}key="mark" {{*}}form=[IsNotEnumerable]

function tagOnAnArm(row, hidden) {
  if (hidden) Object.defineProperty(row, "mark", { value: 1, writable: true, configurable: true });
}
class OnAnArm {
  constructor(n, hidden) {
    tagOnAnArm(this, hidden);
    this.mark = n;
    this.size = n + 1;
  }
}
function tagBehindAReturn(row, hidden) {
  if (!hidden) return;
  Object.defineProperty(row, "mark", { value: 1, writable: true, configurable: true });
}
class BehindAReturn {
  constructor(n, hidden) {
    tagBehindAReturn(this, hidden);
    this.mark = n;
    this.size = n + 1;
  }
}
function tagInALoop(row, times) {
  for (let i = 0; i < times; i++) Object.defineProperty(row, "mark", { value: i, writable: true, configurable: true });
}
class InALoop {
  constructor(n, hidden) {
    tagInALoop(this, hidden ? 1 : 0);
    this.mark = n;
    this.size = n + 1;
  }
}
const later = [];
function tagInAClosure(row) {
  later.push(() => {
    Object.defineProperty(row, "mark", { value: 1, writable: true, configurable: true });
  });
}
class InAClosure {
  constructor(n) {
    tagInAClosure(this);
    this.mark = n;
    this.size = n + 1;
  }
}
function tagStraight(row) {
  Object.defineProperty(row, "mark", { value: 1, writable: true, configurable: true });
}
class MayBeThis {
  constructor(n, hidden) {
    const held = hidden ? this : {};
    tagStraight(held);
    this.mark = n;
    this.size = n + 1;
  }
}
class Straight {
  constructor(n) {
    tagStraight(this);
    this.mark = n;
    this.size = n + 1;
  }
}
function storeOnAnArm(row, plain) {
  if (plain) row.mark = 0;
}
class Reverse {
  constructor(n, plain) {
    storeOnAnArm(this, plain);
    Object.defineProperty(this, "mark", { value: n, writable: true, configurable: true });
    this.size = n + 1;
  }
}
globalThis.keep = [OnAnArm, BehindAReturn, InALoop, InAClosure, MayBeThis, Straight, Reverse].flatMap(Made => [new Made(1, false), new Made(2, true)]);
console.log(globalThis.keep.map(row => Object.keys(row).join() + ":" + row.mark).join(" "));
