// A class, a function or a RegExp that a constant holds is made when it is first needed. A read that comes before the declaration still throws, and one that comes after it finds one object.
// STATISTIC: DeadZonesKeptBesideDefinitions >= 3
function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return (error as Error).name + ": " + (error as Error).message;
  }
}

function useClass(): number {
  return new Late(2).twice();
}

function useSubclass(): number {
  return new LaterStill(3).twice();
}

function useFunction(): number {
  return late(4);
}

function usePattern(): string {
  return pattern.test("aaa") + " " + pattern.lastIndex;
}

function kinds(): string {
  return [attempt(() => typeof Late), attempt(() => typeof LaterStill), attempt(() => typeof late), attempt(() => typeof pattern)].join(", ");
}

function identities(): string {
  return [attempt(() => Late === Late), attempt(() => Object.getPrototypeOf(LaterStill) === Late), attempt(() => late === late), attempt(() => pattern === pattern)].join(", ");
}

function report(when: string): void {
  console.log(when);
  console.log("  " + attempt(useClass) + " | " + attempt(useSubclass) + " | " + attempt(useFunction) + " | " + attempt(usePattern));
  console.log("  " + kinds());
  console.log("  " + identities());
}

report("before every declaration");

class Late {
  constructor(public n: number) {}
  twice() { return this.n * 2; }
}
report("after the class");

const late = (n: number) => n + 1;
report("after the function");

class LaterStill extends Late {
  twice() { return this.n * 3; }
}
report("after the subclass");

const pattern = /a+/g;
report("after the pattern");
report("again");
