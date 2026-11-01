// What follows a `return`, `throw`, `break` or `continue` in its list never runs, and the compiler drops it. What is declared there still counts: a function declaration is created when the list is entered, a `var` is `undefined`, and a `let`, a `const` or a `class` stays in its dead zone.
function attempt(read: () => unknown): string {
  try {
    return String(read());
  } catch (error) {
    return (error as Error).name;
  }
}

function hoistedFunction(): number {
  return later() + 1;
  function later() {
    return 41;
  }
}

function hoistedVariable(): string {
  return typeof late + " " + String(late);
  var late: number | undefined = 1;
}

function deadZoneOfLet(): string {
  return attempt(read);
  let value = 1;
  function read() {
    return value;
  }
}

function deadZoneOfClass(): string {
  return attempt(() => new Late());
  class Late {}
}

function afterFoldedTest(): string {
  if (true) {
    return "taken";
  }
  console.log("never printed");
  return "not taken";
}

function afterBothArms(flag: boolean): string {
  if (flag) {
    return "yes";
  } else {
    return "no";
  }
  console.log("never printed");
}

function inLoops(): number[] {
  const kept: number[] = [];
  for (const item of [1, 2, 3, 4]) {
    if (item === 2) {
      continue;
      kept.push(-item);
    }
    if (item === 4) {
      break;
      kept.push(-item);
    }
    kept.push(item);
  }
  return kept;
}

function inSwitch(key: number): string {
  let found = "";
  switch (key) {
    case 1:
      found += "one";
      break;
      found += " never";
    case 2:
      found += "two";
    default:
      found += " default";
  }
  return found;
}

function leavesLabeledBlock(flag: boolean): string {
  let trail = "";
  block: {
    if (flag) break block;
    trail += "inside ";
  }
  return trail + "after";
}

function throwsFirst(): string {
  return attempt(() => {
    throw new RangeError("first");
    console.log("never printed");
  });
}

console.log(hoistedFunction());
console.log(hoistedVariable());
console.log(deadZoneOfLet());
console.log(deadZoneOfClass());
console.log(afterFoldedTest());
console.log(afterBothArms(true), afterBothArms(false));
console.log(inLoops().join(","));
console.log(inSwitch(1), "|", inSwitch(2), "|", inSwitch(3));
console.log(leavesLabeledBlock(true), "|", leavesLabeledBlock(false));
console.log(throwsFirst());
