// RUN: lower
// OPTIONS: builtin-modules

// A plain object that is made with three properties, given two more, and handed to a typed function that was stored as a value.
interface Berth<Ship, Tide> {
  readonly title: string;
  readonly readsShip: (text: string) => Ship;
  readonly readsTide: (text: string) => Tide;
}
type VisitOf<B> = B extends Berth<infer Ship, infer Tide>
  ? { readonly ship: Ship; readonly tide: Tide; readonly pilot: string; readonly quay: string; readonly flag: string }
  : never;
type Greeter<B> = (visit: VisitOf<B>) => string;

class Harbor<Berths extends Record<string, Berth<any, any>>> {
  readonly greeters: Greeter<any>[] = [];
  readonly places = new Map<string, number>();
  constructor(readonly berths: Berths) {}
  greets<Name extends keyof Berths & string>(name: Name, greeter: Greeter<Berths[Name]>): this {
    this.places.set(name, this.greeters.push(greeter as Greeter<any>) - 1);
    return this;
  }
  arrives(name: string, tide: string, ship: string): string {
    const berth: Berth<any, any> = this.berths[name]!;
    const visit: any = { pilot: "the pilot of " + name, flag: "blue", quay: berth.title };
    visit.tide = berth.readsTide(tide);
    visit.ship = berth.readsShip(ship);
    const greeter = this.greeters[this.places.get(name)!]!;
    return greeter(visit);
  }
}

const north: Berth<{ readonly tons: number }, { readonly feet: number }> = {
  title: "north quay",
  readsShip: text => ({ tons: Number(text) }),
  readsTide: text => ({ feet: Number(text) }),
};
const harbor = new Harbor({ north }).greets(
  "north",
  ({ flag, quay, pilot, tide, ship }) => `${ship.tons} ${tide.feet} ${pilot} ${quay} ${flag}`,
);
console.log(harbor.arrives("north", "2", "42"));
console.log(harbor.arrives("north", "3", "7"));

// CHECK-LABEL: function {{*}}name="Harbor"
// CHECK-LABEL: function {{*}}name="greets"
// CHECK-LABEL: function {{*}}name="arrives"
// CHECK-LABEL: function {{*}}name="readsShip"
