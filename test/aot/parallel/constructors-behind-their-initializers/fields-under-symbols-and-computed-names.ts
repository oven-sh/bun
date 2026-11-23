const show = (label: string, made: object) => console.log(label, JSON.stringify(Reflect.ownKeys(made).map(String)), JSON.stringify(Object.entries(Object.getOwnPropertyDescriptors(made)).map(([name, d]) => [name, "value" in d ? d.value : "accessor", d.writable, d.enumerable, d.configurable])), Object.isExtensible(made), Object.isFrozen(made));
const attempt = (label: string, make: () => object) => { try { show(label, make()); } catch (error) { console.log(label, (error as Error).name); } };
const kState = Symbol("state");
const name = ["na", "me"].join(""); // @ts-expect-error
class Exchange { [kState]: number; [name]: string; plain: number; constructor() { this.plain = 1; this[kState] = 2; (this as any)[name] = "three"; } }
for (let round = 0; round < 3; round++) attempt(`${round}`, () => new Exchange());
