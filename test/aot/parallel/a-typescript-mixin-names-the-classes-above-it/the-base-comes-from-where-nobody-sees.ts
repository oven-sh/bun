type Made<T = object> = new (...args: any[]) => T;
class Seen { s = 1; name(): string { return "seen" + this.s; } }
class Hidden { h = "x"; name(): string { return "hidden" + this.h; } }
function marked<B extends Made<{ name(): string }>>(Base: B) { return class Marked extends Base { m = 5; name(): string { return super.name() + "/" + this.m; } }; }
const InSight = marked(Seen);
const bases: Made<{ name(): string }>[] = [Seen, Hidden, class { name() { return "nameless"; } }];
for (const which of JSON.parse("[1, 0, 2, 1]") as number[]) {
  const Other = marked(bases[which]);
  console.log(new Other().name(), new InSight().name(), Object.keys(new Other()).join(), new Other() instanceof Seen);
}
