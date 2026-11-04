const show = (label: string, made: object) => console.log(label, JSON.stringify(Reflect.ownKeys(made).map(String)), JSON.stringify(Object.entries(Object.getOwnPropertyDescriptors(made)).map(([name, d]) => [name, "value" in d ? d.value : "accessor", d.writable, d.enumerable, d.configurable])), Object.isExtensible(made), Object.isFrozen(made));
const attempt = (label: string, make: () => object) => { try { show(label, make()); } catch (error) { console.log(label, (error as Error).name); } };
let meddle: (made: any) => void = () => {};
class Exchange {
  flags: number;
  state: number;
  label = "made";
  count: number;
  constructor(flags: number) {
    this.flags = flags;
    this.state = 0;
    meddle(this);
    this.count = 1;
    this.state = 2;
  }
}
function turns(ways: [string, (made: any) => void][]) {
  for (let round = 0; round < 3; round++) {
    for (const [label, way] of ways) {
      meddle = way;
      attempt(`${round} ${label}`, () => new Exchange(round));
    }
  }
}
turns([["plain", () => {}], ["read-only", made => { Object.defineProperty(made, "count", { writable: false }); }], ["hidden", made => { Object.defineProperty(made, "state", { enumerable: false }); }], ["fixed", made => { Object.defineProperty(made, "count", { configurable: false }); }]]);
