// `this` of a method is the class by declaration. call, apply, bind and a method that is taken off its object hand it something else.
function show(label: string, run: () => unknown) {
  try {
    console.log(label, String(run()));
  } catch (error) {
    console.log(label, "threw", (error as Error).constructor.name, (error as Error).message);
  }
}
class Counter {
  count = 1;
  step = 2;
  next() {
    const count = this.count;
    const step = this.step;
    this.count = count + step;
    return "count " + this.count + " step " + step;
  }
  get twice() {
    const count = this.count;
    return count * 2 + this.step;
  }
  set twice(value: number) {
    const half = value / 2;
    this.count = half + this.step - this.step;
  }
  static make() {
    return new this();
  }
}
class Other {
  count = "one";
  step = "two";
}
const counter = new Counter();
show("right", () => counter.next());
const others: any[] = [new Other(), { count: 10, step: 20 }, { step: 1 }, {}, 5, "text", true, null, undefined, [1, 2], () => 1, Object.create(counter), Object.create(null)];
for (let i = 0; i < others.length; i++) {
  show("call " + i, () => counter.next.call(others[i]));
  show("apply " + i, () => counter.next.apply(others[i], []));
  show("bind " + i, () => counter.next.bind(others[i])());
  show("reflect " + i, () => Reflect.apply(counter.next, others[i], []));
  show("getter " + i, () => Object.getOwnPropertyDescriptor(Counter.prototype, "twice")!.get!.call(others[i]));
  show("setter " + i, () => (Object.getOwnPropertyDescriptor(Counter.prototype, "twice")!.set!.call(others[i], 8), others[i] == null ? "none" : String(others[i].count)));
  show("right between " + i, () => counter.next());
}
const taken = counter.next;
show("taken off", () => taken());
const holder = { count: 100, step: 1, next: counter.next };
show("on another holder", () => holder.next());
show("static right", () => Counter.make().next());
show("static taken off", () => (0, Counter.make)());
show("static on another class", () => String(Counter.make.call(Other).count));
show("right at the end", () => counter.next() + " " + counter.twice);
