import "reflect-metadata";
import { Container, inject, injectable, named } from "inversify";

interface Weapon {
  hit(): string;
}
interface Warrior {
  fight(): string;
}
const TYPES = { Warrior: Symbol.for("Warrior"), Weapon: Symbol.for("Weapon") };
@injectable()
class Katana implements Weapon {
  hit() {
    return "cut!";
  }
}
@injectable()
class Shuriken implements Weapon {
  hit() {
    return "hit!";
  }
}
@injectable()
class Counter {
  static made = 0;
  id = ++Counter.made;
}
@injectable()
class Ninja implements Warrior {
  constructor(
    @inject(TYPES.Weapon) @named("near") private readonly katana: Weapon,
    @inject(TYPES.Weapon) @named("far") private readonly shuriken: Weapon,
    public readonly counter: Counter,
  ) {}
  fight() {
    return this.katana.hit() + this.shuriken.hit();
  }
}
const container = new Container();
container.bind<Warrior>(TYPES.Warrior).to(Ninja);
container.bind<Weapon>(TYPES.Weapon).to(Katana).whenNamed("near");
container.bind<Weapon>(TYPES.Weapon).to(Shuriken).whenNamed("far");
container.bind(Counter).toSelf().inSingletonScope();
const ninja = container.get<Warrior>(TYPES.Warrior) as Ninja;
console.log(
  ninja.fight(),
  ninja instanceof Ninja,
  ninja.counter.id,
  (container.get<Warrior>(TYPES.Warrior) as Ninja).counter.id,
  container.isBound(TYPES.Weapon, { name: "far" }),
  container.getAll<Weapon>(TYPES.Weapon, { name: "near" }).length,
);
try {
  container.get(Symbol.for("Nothing"));
} catch (error) {
  console.log((error as Error).message.split("\n")[0]);
}
