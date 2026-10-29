// `n: number;` is defined as undefined and the constructor always stores a number first, so the field is always filled with a number, whatever the other members of the class are.
// IR-UNTIL ApplyFlowResults
// IR+ ^layout .*name="Alone" .*\{key="n" declared=\{[^}]*\} flags=\[[^\]]*\] flow=\{location=\{[^}]*\} occupancy=AlwaysFilled
// IR+ ^layout .*name="WithList" .*\{key="n" declared=\{[^}]*\} flags=\[[^\]]*\] flow=\{location=\{[^}]*\} occupancy=AlwaysFilled
// IR+ ^layout .*name="WithCounter" .*\{key="n" declared=\{[^}]*\} flags=\[[^\]]*\] flow=\{location=\{[^}]*\} occupancy=AlwaysFilled
// IR+ ^layout .*name="WithPrivate" .*\{key="n" declared=\{[^}]*\} flags=\[[^\]]*\] flow=\{location=\{[^}]*\} occupancy=AlwaysFilled
// IR+ ^layout .*name="WithArrow" .*\{key="n" declared=\{[^}]*\} flags=\[[^\]]*\] flow=\{location=\{[^}]*\} occupancy=AlwaysFilled
// IR+ ^layout .*name="WithComputed" .*\{key="n" declared=\{[^}]*\} flags=\[[^\]]*\] flow=\{location=\{[^}]*\} occupancy=AlwaysFilled
class Base {
  id: number = 1;
}
class Alone extends Base {
  n: number;
  constructor(n: number) {
    super();
    this.n = n;
  }
}
class WithList extends Base {
  list: number[] = [];
  n: number;
  constructor(n: number) {
    super();
    this.n = n;
  }
}
function makeWithCounter() {
  let made = 0;
  return class WithCounter extends Base {
    order: number = made++;
    n: number;
    constructor(n: number) {
      super();
      this.n = n;
    }
  };
}
const WithCounter = makeWithCounter();
class WithPrivate extends Base {
  #p: number = 1;
  n: number;
  constructor(n: number) {
    super();
    this.n = n;
  }
  p(): number {
    return this.#p;
  }
}
class WithArrow {
  n: number;
  on = () => this.n;
  constructor(n: number) {
    this.n = n;
  }
}
const key = Symbol("key");
class WithComputed {
  n: number;
  [key] = 1;
  constructor(n: number) {
    this.n = n;
  }
}
let total = 0;
for (let i = 0; i < 100; i++) {
  const n = i & 15;
  total += new Alone(n).n;
  const withList = new WithList(n);
  withList.list.push(n);
  total += withList.n + withList.list.length;
  const withCounter = new WithCounter(n);
  total += withCounter.n + withCounter.order;
  const withPrivate = new WithPrivate(n);
  total += withPrivate.n + withPrivate.p();
  const withArrow = new WithArrow(n);
  total += withArrow.n + withArrow.on();
  const withComputed = new WithComputed(n);
  total += withComputed.n + withComputed[key];
}
console.log(total);
