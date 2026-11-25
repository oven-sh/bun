const show = (label: string, made: object) => console.log(label, JSON.stringify(Reflect.ownKeys(made).map(String)), JSON.stringify(Object.entries(Object.getOwnPropertyDescriptors(made)).map(([name, d]) => [name, "value" in d ? d.value : "accessor", d.writable, d.enumerable, d.configurable])), Object.isExtensible(made), Object.isFrozen(made));
const attempt = (label: string, make: () => object) => { try { show(label, make()); } catch (error) { console.log(label, (error as Error).name); } };
class Exchange { flags: number; state: number; label = "made"; count: number; constructor(flags: number) { this.flags = flags; this.state = 0; this.count = 1; } }
class Other { other = 1; }
function Plain() {}
Plain.prototype = { set count(value: number) { console.log("set above", value); } };
for (let round = 0; round < 3; round++) {
  attempt(`${round} own`, () => new Exchange(round));
  attempt(`${round} other`, () => Reflect.construct(Exchange, [round], Other));
  attempt(`${round} plain`, () => Reflect.construct(Exchange, [round], Plain));
  attempt(`${round} proxy`, () => Reflect.construct(Exchange, [round], new Proxy(Exchange, { get(target, key, receiver) { if (key === "prototype") console.log("get prototype"); return Reflect.get(target, key, receiver); } })));
}
