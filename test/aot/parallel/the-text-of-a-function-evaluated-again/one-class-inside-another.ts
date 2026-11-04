// A class with parameter properties inside a default, a method and the constructor of another one.
class Outer {
  constructor(
    public made = class { constructor(public deep: number) {} },
    readonly count = 2,
  ) {
    class Local { constructor(public near: number) {} }
    this.local = JSON.stringify(new Local(count));
  }
  local: string;
  build() { return class { constructor(private inner: string) {} show() { return this.inner; } }; }
}
const evaluate = (text: string): any => (0, eval)("(" + text + ")");
for (const Made of [Outer, evaluate(String(Outer))]) {
  const outer = new Made();
  const Built = outer.build();
  console.log(Object.keys(outer).join(), outer.local, JSON.stringify(new outer.made(1)), new Built("in").show());
  console.log(JSON.stringify(new (evaluate(String(outer.made)))(5)), new (evaluate(String(Built)))("again").show());
}
