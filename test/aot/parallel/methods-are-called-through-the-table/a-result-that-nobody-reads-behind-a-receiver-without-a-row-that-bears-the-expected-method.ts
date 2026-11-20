// STATISTIC: MethodCallsThroughTable = 0
declare const seen: any;
function note(value: any) {}

class Idle {}

class Counter {
  bump() {}
}
function turn(holder: any): any {
  for (;;) {
    while (holder !== holder) note(holder);
    holder.bump();
    while (seen);
  }
}
const idle: any = new Idle();

class Plain {}

class Stepper extends Plain {
  bump() {}
}
function pass(holder: any, more?: any): any {
  note(holder);
}
const plain: any = new Plain();

class Spare {}
function spin(holder: any, other: any): any {
  for (;;) note(other);
}
Reflect.set(idle, ["bump"][0], Counter.prototype.bump);
try {
  turn(idle), turn(new Counter())(idle())[(pass(new Stepper()), pass(plain, plain()))](spin(0, new Spare()).join);
} catch (error: any) {
  console.log(error.constructor.name);
}
