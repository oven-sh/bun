abstract class Base {
  count = 0;
  step(by: number): number { return (this.count += by); }
}
class First extends Base {}
class Second extends Base { step(by: number) { return (this.count = (this.count + by * 2) & 255); } }

function run(all: Base[], by: number): number {
  let sum = 0;
  for (const each of all) sum += each.step(by);
  return sum;
}

const all: Base[] = [];
for (let i = 0; i < 8; i++) all.push(i & 1 ? new First() : new Second());
console.log(run(all, 1), run(all, 2));
all.push(new (Object.getPrototypeOf(First))());
console.log(run(all, 1), all[8].constructor === Base, all[8] instanceof First);
all.push(new (all[8].constructor as any)(), Reflect.construct(First, [], Base as any), Reflect.construct(Base as any, [], Second));
console.log(run(all, 3), all.map(each => each.constructor.name).join());
