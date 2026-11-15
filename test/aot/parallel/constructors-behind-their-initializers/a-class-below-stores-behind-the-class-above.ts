const show = (label: string, made: object) => console.log(label, JSON.stringify(Reflect.ownKeys(made).map(String)), JSON.stringify(Object.entries(Object.getOwnPropertyDescriptors(made)).map(([name, d]) => [name, "value" in d ? d.value : "accessor", d.writable, d.enumerable, d.configurable])), Object.isExtensible(made), Object.isFrozen(made));
const attempt = (label: string, make: () => object) => { try { show(label, make()); } catch (error) { console.log(label, (error as Error).name); } };
let meddle: (made: any) => void = () => {};
class Above { first: number; second = 2; constructor() { this.first = 1; meddle(this); this.second = 3; } }
class Below extends Above { third: number; fourth = 4; constructor() { super(); this.third = 3; meddle(this); this.fourth = 5; this.first = 6; } }
for (let round = 0; round < 3; round++) {
  for (const [label, way] of [["plain", () => {}], ["deletes", (made: any) => { delete made.second; delete made.fourth; }], ["closes", (made: any) => { Object.preventExtensions(made); }]] as [string, (made: any) => void][]) {
    meddle = way;
    attempt(`${round} ${label} above`, () => new Above());
    attempt(`${round} ${label} below`, () => new Below());
  }
}
