type Constructor<T = {}> = new (...list: any[]) => T;
class Entity {
  id: number = 7;
  log: string[] = [];
  constructor() { this.init(); }
  init(): void { this.log.push("Entity.init " + this.id); }
  describe(): string { return "entity " + this.id; }
}
function Timestamped<T extends Constructor<Entity>>(Base: T) {
  return class extends Base {
    stamp: number = 1.5;
    init(): void { super.init(); this.log.push("Timestamped.init " + this.stamp); }
  };
}
function Named<T extends Constructor<Entity>>(Base: T) {
  return class extends Base {
    name: string = "n" + this.id;
    describe(): string { return this.name + " " + super.describe(); }
  };
}
const Full = Named(Timestamped(Entity)), Other = Timestamped(Named(Entity)), Twice = Timestamped(Timestamped(Entity));
for (const K of [Entity, Full, Other, Twice]) {
  const o = new K();
  console.log(o.describe(), o.log.join("|"), Object.keys(o).join(), o instanceof Entity, (o as any).stamp, (o as any).name);
}
