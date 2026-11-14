abstract class Base {
  count = 0;
  tag = "b";
  step(by: number): number { return (this.count += by); }
  abstract name(): string;
}
class First extends Base { name() { return "first" + this.count; } }
class Second extends Base { step(by: number) { return (this.count = (this.count + by * 2) & 255); } name() { return "second"; } }
class Third extends Base { step(by: number) { this.tag = by & 1 ? "odd" : "even"; return this.tag.length; } name() { return "third" + this.tag; } }

function run(all: Base[], by: number): string {
  let sum = 0;
  let text = "";
  for (const each of all) {
    try {
      sum += each.step(by);
      text = each.name();
    } catch (error) {
      text = (error as Error).constructor.name;
      sum += 7;
    }
  }
  return sum + " " + text;
}

const all: any[] = [];
for (let i = 0; i < 9; i++) all.push(i % 3 === 0 ? new First() : i % 3 === 1 ? new Second() : new Third());
const report = () => console.log(run(all, 1), run(all, 2), run(all, 3));
report();
Object.setPrototypeOf(all[0], Base.prototype);
report();
all.push(Object.create(Base.prototype));
report();
all.push({ __proto__: Base.prototype, count: 1, tag: "l" });
report();
function Unrelated() {}
Unrelated.prototype = { step: () => 5, name: () => "unrelated" };
all.push(Reflect.construct(First, [], Unrelated));
report();
(Unrelated as any).prototype = null;
all.push(Reflect.construct(First, [], Unrelated));
report();
all.push(new (class extends Base { name() { return "anonymous"; } })());
report();
