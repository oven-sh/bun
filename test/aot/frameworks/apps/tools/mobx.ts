import {
  action,
  autorun,
  computed,
  configure,
  makeAutoObservable,
  makeObservable,
  observable,
  reaction,
  runInAction,
  toJS,
  when,
} from "mobx";

configure({ enforceActions: "always" });
class Timer {
  secondsPassed = 0;
  laps: number[] = [];
  constructor() {
    makeAutoObservable(this);
  }
  increase() {
    this.secondsPassed += 1;
  }
  lap() {
    this.laps.push(this.secondsPassed);
  }
  get double() {
    return this.secondsPassed * 2;
  }
}
const timer = new Timer(),
  seen: string[] = [];
const stop = autorun(() => seen.push(`auto ${timer.secondsPassed} ${timer.double} ${timer.laps.length}`));
reaction(
  () => timer.laps.length,
  (length, before) => seen.push(`laps ${before}>${length}`),
);
const reached = when(() => timer.secondsPassed >= 2);
timer.increase();
timer.lap();
runInAction(() => {
  timer.increase();
  timer.increase();
});
stop();
timer.increase();
await reached;
console.log(seen.join(" | "), JSON.stringify(toJS(timer)));
class Doubler {
  value: number;
  constructor(value: number) {
    makeObservable(this, { value: observable, double: computed, increment: action });
    this.value = value;
  }
  get double() {
    return this.value * 2;
  }
  increment() {
    this.value++;
  }
}
const doubler = new Doubler(1),
  map = observable.map({ a: 1 });
doubler.increment();
console.log(
  doubler.double,
  computed(() => map.get("a")! + 1).get(),
  map.has("b"),
  observable.box(3).get(),
  observable([1, 2]).slice().length,
);
