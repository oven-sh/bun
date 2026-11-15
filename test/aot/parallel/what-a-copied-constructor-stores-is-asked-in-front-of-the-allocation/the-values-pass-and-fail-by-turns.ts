// A constructor function whose fields have written types is handed whatever comes: what fits is listed at the allocation, what does not goes the closed way, and both give the object that `bun <file>` gives.
// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: what the allocation lists is held against what its slots take
interface Sign { flags: number; name: string; id: number; parent?: Sign; members?: object; exports?: object; links?: object; }
function Sign(this: Sign, flags: number, name: string) { this.flags = flags; this.name = name; this.id = 0; this.parent = undefined; this.members = undefined; this.exports = undefined; this.links = undefined; }
const Maker: new (flags: number, name: string) => Sign = Sign as any;
function make(flags: any, name: any) { return new Maker(flags, name); }
function masked(flags: any, name: any) { return new Maker(flags | 32, name); }
function fill(sign: Sign, value: object) { sign.members = value; sign.links = value; sign.parent = sign; }
const told = (sign: Sign) => Object.keys(sign).join() + " " + typeof sign.flags + ":" + String(sign.flags) + " " + typeof sign.name + ":" + String(sign.name) + " " + sign.id + " " + String(sign.members) + " " + ("exports" in sign) + " " + (sign instanceof Maker);
const flags: any[] = JSON.parse('[1, 2.5, -2147483648, -2147483644, 2147483647, 4294967296, "7", null, true, {"valueOf": 1}, [3]]'); flags.push(undefined, NaN, -0, 10n === 10n ? Symbol.iterator.description : 0);
const names: any[] = JSON.parse('["n", "", 7, null, {"n": 1}, [1], true, 2.5]'); names.push(undefined);
for (const flag of flags) for (const name of names) { const sign = make(flag, name); console.log(told(sign)); }
for (const flag of flags) for (const name of names) { try { const sign = masked(flag, name); console.log(told(sign)); fill(sign, names); console.log(Object.keys(sign).join(), sign.parent === sign); } catch (error) { console.log((error as Error).name); } }
