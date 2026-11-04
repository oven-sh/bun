const show = (label: string, made: object) => console.log(label, JSON.stringify(Reflect.ownKeys(made).map(String)), JSON.stringify(Object.entries(Object.getOwnPropertyDescriptors(made)).map(([name, d]) => [name, "value" in d ? d.value : "accessor", d.writable, d.enumerable, d.configurable])), Object.isExtensible(made), Object.isFrozen(made));
const attempt = (label: string, make: () => object) => { try { show(label, make()); } catch (error) { console.log(label, (error as Error).name); } };
let fails = false;
const seen: string[] = [];
class Exchange { flags: number; state = (() => { seen.push(JSON.stringify(Object.keys(this))); if (fails) throw new RangeError("state"); return 1; })(); count: number; constructor() { this.flags = 1; this.count = 2; this.state = 3; } }
for (let round = 0; round < 4; round++) { fails = round === 2; attempt(`${round}`, () => new Exchange()); }
console.log(seen.join(" "));
