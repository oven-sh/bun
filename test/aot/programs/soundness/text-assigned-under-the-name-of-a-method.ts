// Object.assign takes its target as an object, so the checker lets it put anything under the name of a method.
// The typed call that follows throws a TypeError, as in plain Bun. It never calls what is no function.
interface Shape {
  m(): string;
}
class A implements Shape {
  m(): string {
    return "m";
  }
}
function make(): Shape {
  return new A();
}
function report(label: string, o: Shape): void {
  try {
    console.log(label, o.m());
  } catch (e) {
    console.log(label, "threw", e instanceof TypeError);
  }
}

const first: Shape = new A();
Object.assign(first, { early: 1, m: "assigned" });
report("beside a name that the class does not have", first);

const second = make();
report("before", second);
Object.assign(second, { early: 1, m: "assigned", late: 2 });
report("between two such names", second);
console.log(Object.keys(second).join());

const third = make();
Object.assign(third, { m: 7 });
report("alone", third);

const fourth = make();
Object.assign({}, {
  get trigger() {
    Object.assign(fourth, { early: 1, m: "assigned" });
    return 1;
  },
});
report("inside a getter that Object.assign runs", fourth);

const fifth = make();
Object.assign(fifth, { early: 1, m: () => "replaced" });
report("a function", fifth);
report("another object of the class", make());
