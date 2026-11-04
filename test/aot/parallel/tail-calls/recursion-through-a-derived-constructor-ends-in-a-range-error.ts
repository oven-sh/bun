// the constructor of a base class constructs a class derived from it, whose constructor calls super, without end: the stack overflows, the error is caught, and the program goes on
let turns = 0;
let limit = 0;
class Base {
  made = 0;
  constructor() {
    turns++;
    if (!limit || turns < limit) this.made = new Derived().made + 1;
  }
}
class Derived extends Base {
  constructor() {
    super();
  }
}
function deed() {
  turns = 0;
  try {
    return String(new Derived().made);
  } catch (e) {
    return (e as Error).name + " " + (turns > 100);
  }
}
console.log(deed());
for (let i = 0; i < 3; i++) console.log(deed());
limit = 5;
console.log(deed());
