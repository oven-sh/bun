// One call site, many receivers, one method name: some methods take fewer arguments than the call passes, one collects the rest, one looks at `arguments`, one has a default.
// And the order of a call: the member is read first, then the arguments are evaluated, then the call is made.
const log: string[] = [];

class Ctx {
  depth: number;
  constructor(depth: number) {
    this.depth = depth;
  }
}

abstract class Visitor {
  abstract visit(n: number, c: Ctx): number;
}
class OnlyNumber extends Visitor {
  visit(n: number) {
    return n;
  }
}
class OnlyNumberToo extends Visitor {
  visit(n: number) {
    return n + 1;
  }
}
class Both2 extends Visitor {
  visit(n: number, c: Ctx) {
    return n + c.depth + 2;
  }
}
class Both3 extends Visitor {
  visit(n: number, c: Ctx) {
    return n + c.depth + 3;
  }
}
class Both4 extends Visitor {
  visit(n: number, c: Ctx) {
    return n + c.depth + 4;
  }
}
class Both5 extends Visitor {
  visit(n: number, c: Ctx) {
    return n + c.depth + 5;
  }
}
class Both6 extends Visitor {
  visit(n: number, c: Ctx) {
    return n + c.depth + 6;
  }
}
class Both7 extends Visitor {
  visit(n: number, c: Ctx) {
    return n + c.depth + 7;
  }
}
class Both8 extends Visitor {
  visit(n: number, c: Ctx) {
    return n + c.depth + 8;
  }
}
const visitors: Visitor[] = [new OnlyNumber(), new OnlyNumberToo(), new Both2(), new Both3(), new Both4(), new Both5(), new Both6(), new Both7(), new Both8()];
function visitAll(n: number, c: Ctx): number {
  let sum = 0;
  for (let i = 0; i < visitors.length; i++) sum = (sum + visitors[i].visit(n, c)) | 0;
  return sum;
}
console.log(visitAll(1, new Ctx(10)), visitAll(2, new Ctx(0)));

// The surplus argument is kept: in a list, among `arguments`, by a default that is not taken.
abstract class Keeper {
  abstract keep(n: number, c: unknown): string;
}
class Drops extends Keeper {
  keep(n: number) {
    return "drops " + n;
  }
}
class Collects extends Keeper {
  keep(n: number, ...rest: unknown[]) {
    return "collects " + n + " " + rest.length + " " + typeof rest[0];
  }
}
class Looks extends Keeper {
  keep(n: number) {
    return "looks " + n + " " + arguments.length + " " + typeof arguments[1];
  }
}
class Defaults extends Keeper {
  keep(n: number, c: unknown = "default") {
    return "defaults " + n + " " + typeof c;
  }
}
class TakesString extends Keeper {
  keep(n: number, c: unknown) {
    return "takes " + n + " " + String(c);
  }
}
class TakesToo extends Keeper {
  keep(n: number, c: unknown) {
    return "takes too " + n + " " + typeof c;
  }
}
const keepers: Keeper[] = [new Drops(), new Collects(), new Looks(), new Defaults(), new TakesString(), new TakesToo()];
function keepAll(n: number, c: unknown): string {
  let text = "";
  for (let i = 0; i < keepers.length; i++) text += keepers[i].keep(n, c) + "; ";
  return text;
}
console.log(keepAll(1, "s"));
console.log(keepAll(2, undefined));
console.log(keepAll(3, new Ctx(1)));
console.log(keepAll(4, 5));

// A variable is read between the read of the member and the call. Nobody touches these classes.
abstract class Walker {
  abstract walk(n: number, c: Ctx): number;
}
class Walk0 extends Walker {
  walk(n: number, c: Ctx) {
    return n + c.depth;
  }
}
class Walk1 extends Walker {
  walk(n: number, c: Ctx) {
    return n + c.depth + 1;
  }
}
class Walk2 extends Walker {
  walk(n: number, c: Ctx) {
    return n + c.depth + 2;
  }
}
class Walk3 extends Walker {
  walk(n: number, c: Ctx) {
    return n + c.depth + 3;
  }
}
class Walk4 extends Walker {
  walk(n: number, c: Ctx) {
    return n + c.depth + 4;
  }
}
class Walk5 extends Walker {
  walk(n: number, c: Ctx) {
    return n + c.depth + 5;
  }
}
const walkers: Walker[] = [new Walk0(), new Walk1(), new Walk2(), new Walk3(), new Walk4(), new Walk5()];
let current = new Ctx(100);
function walkAll(n: number): number {
  let sum = 0;
  for (let i = 0; i < walkers.length; i++) sum = (sum + walkers[i].walk(n, current)) | 0;
  return sum;
}
console.log(walkAll(1));
current = new Ctx(200);
console.log(walkAll(1));

// The same, and one of the classes gets a getter for the member that changes the variable: the argument is what the variable holds behind the getter.
abstract class Stepper {
  abstract step(n: number, c: Ctx): number;
}
class Step0 extends Stepper {
  step(n: number, c: Ctx) {
    return n + c.depth;
  }
}
class Step1 extends Stepper {
  step(n: number, c: Ctx) {
    return n + c.depth + 1;
  }
}
class Step2 extends Stepper {
  step(n: number, c: Ctx) {
    return n + c.depth + 2;
  }
}
class Step3 extends Stepper {
  step(n: number, c: Ctx) {
    return n + c.depth + 3;
  }
}
class Step4 extends Stepper {
  step(n: number, c: Ctx) {
    return n + c.depth + 4;
  }
}
class Step5 extends Stepper {
  step(n: number, c: Ctx) {
    return n + c.depth + 5;
  }
}
const steppers: Stepper[] = [new Step0(), new Step1(), new Step2(), new Step3(), new Step4(), new Step5()];
let seen = new Ctx(1000);
function stepAll(n: number): number {
  let sum = 0;
  for (let i = 0; i < steppers.length; i++) sum = (sum + steppers[i].step(n, seen)) | 0;
  return sum;
}
console.log(stepAll(1));
const original = Step3.prototype.step;
Object.defineProperty(Step3.prototype, "step", {
  configurable: true,
  get() {
    log.push("getter");
    seen = new Ctx(seen.depth * 2);
    return original;
  },
});
console.log(stepAll(1), seen.depth, log.join());
(steppers[1] as any).step = function (n: number, c: Ctx) {
  return -c.depth;
};
console.log(stepAll(1), seen.depth, log.join());

// The receiver is missing, and the argument would throw too: the read of the member throws first.
function firstThrows(w: Walker | undefined): string {
  try {
    return String(w!.walk(1, notYet));
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
console.log(firstThrows(undefined));
console.log(firstThrows(walkers[0]));
let notYet = new Ctx(7);
console.log(firstThrows(undefined), firstThrows(walkers[2]));

// A receiver of which only the names say what it may be: the guess is right, wrong, or there is no such method. What stands behind the call runs all the same.
class Plain {
  x = 1;
  measure() {
    return 2;
  }
}
class Other {
  x = 2;
  y = 3;
  measure() {
    return 3;
  }
}
function measureAndRead(o: any, n: number): string {
  let a: unknown;
  try {
    a = o.measure() + o.x;
  } catch (error) {
    a = (error as Error).constructor.name;
  }
  log.push(String(a));
  return a + ":" + n;
}
const shadowed: any = new Plain();
shadowed.measure = () => 40;
const inherits: any = Object.create(new Other());
const things: any[] = [new Plain(), new Other(), JSON.parse('{"x":5}'), shadowed, inherits, { x: "s", measure: () => "m" }, null, 7];
log.length = 0;
console.log(things.map((o, i) => measureAndRead(o, i)).join(" "));
(Plain.prototype as any).measure = function () {
  return 200;
};
console.log(things.map((o, i) => measureAndRead(o, i)).join(" "));
console.log(log.join());

let total = 0;
const shared = new Ctx(1);
for (let round = 0; round < 20000; round++) total = (total + visitAll(round, shared) + walkAll(round) + stepAll(round) + keepAll(round, round).length) | 0;
console.log(total, seen.depth === Infinity);
