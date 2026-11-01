// A variable that closures share is declared as an interface. An object of another class and then whole numbers reach it through `any`, some through a type parameter, and it is the key of compound assignments.
interface Named {
  name: string;
}
class Other {
  other = 1;
}
class Box<T> {
  constructor(public value: T) {}
  map<U>(change: (value: T) => U): Box<U> {
    return new Box<U>(change(this.value));
  }
}
function passThroughBox<T>(value: T): T {
  return new Box<T>(value).map<T>(inner => inner).value;
}
function passThroughCallback<T>(value: T): T {
  return [value].map((element: T): T => element)[0];
}
function pick(which: number): any {
  return which === 0 ? new Other() : which;
}

let held: Named = pick(0);
const read = () => held;
const sums: any = [0, 0, 0, 0];
for (let turn = 1; turn < 4; turn++) {
  held = pick(turn);
  sums[held as any] += turn;
}
console.log(sums, typeof read());

function count(turns: number): unknown {
  let key: Named = passThroughBox<Named>(new Other() as any);
  const show = () => typeof key;
  const powers: any = [2, 2, 2, 2];
  const steps: any = {};
  for (let turn = 0; turn < turns; turn++) {
    key = passThroughBox<Named>(turn as any);
    powers[key as any] **= turn;
    steps[key as any] ??= turn;
    steps[key as any]++;
  }
  return [powers, steps, show()];
}
console.log(count(4));

function countDown(): number {
  let turns = 0;
  let outer = 0;
  do {
    let left: Named = passThroughCallback<Named>(3 as any);
    const isLeft = () => (left as any)--;
    while (isLeft()) turns++;
    left = passThroughCallback<Named>(new Other() as any);
    outer++;
  } while (outer < 3);
  return turns;
}
console.log(countDown());
