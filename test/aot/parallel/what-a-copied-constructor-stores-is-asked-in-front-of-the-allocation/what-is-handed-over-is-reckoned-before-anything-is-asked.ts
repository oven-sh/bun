// The arguments of the construction run their own code, in order, once, before any look and whichever way the birth goes.
// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: what the allocation lists is held against what its slots take
interface Sign { flags: number; name: string; members?: object; links?: object; }
function Sign(this: Sign, flags: number, name: string) { this.flags = flags; this.name = name; this.members = undefined; this.links = undefined; }
const Maker: new (flags: number, name: string) => Sign = Sign as any;
const said: string[] = [];
function first(value: any) { said.push("first"); return value; }
function second(value: any) { said.push("second"); return value; }
function make(flags: any, name: any) { return new Maker(first(flags) | 4, second(name)); }
function fill(sign: Sign, value: object) { sign.members = value; sign.links = value; }
const given: any[] = [[1, "a"], [{ valueOf() { said.push("valueOf"); return 8; } }, "b"], [2, { toString() { said.push("toString"); return "never"; } }], [{ valueOf() { said.push("throws"); throw new RangeError("no"); } }, "d"], [3, 4]];
for (const [flags, name] of given) { try { const sign = make(flags, name); console.log(Object.keys(sign).join(), sign.flags, typeof sign.name, said.join()); fill(sign, given); } catch (error) { console.log((error as Error).name, said.join()); } said.length = 0; }
