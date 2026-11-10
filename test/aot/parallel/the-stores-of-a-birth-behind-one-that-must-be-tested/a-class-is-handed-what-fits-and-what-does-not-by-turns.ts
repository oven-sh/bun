// A class whose fields have written types is handed whatever comes: what fits goes the fast way, what does not goes the slow version from the head, and both give the object that `bun <file>` gives.
// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: what stands behind the guard is held against what arrives
class Sign {
    flags: number; name: string; list?: object[]; id: number; parent?: Sign; members?: object; exports?: object; twin?: Sign; only?: boolean; used?: number; place?: number; links?: object;
    constructor(flags: number, name: string) {
        this.flags = flags; this.name = name; this.list = undefined; this.id = 0; this.parent = undefined; this.members = undefined; this.exports = undefined;
        this.twin = undefined; this.only = undefined; this.used = undefined; this.place = undefined; this.links = undefined;
    }
}
function make(flags: any, name: any) { return new Sign(flags, name); }
function masked(flags: any, name: any) { return new Sign(flags | 32, name); }
function fill(sign: Sign, value: object) { sign.exports = value; sign.place = 7; sign.members = value; sign.twin = sign; sign.only = true; sign.used = 3; sign.list = [sign]; sign.parent = sign; sign.links = value; }
const told = (sign: Sign) => Object.keys(sign).join() + " " + typeof sign.flags + ":" + String(sign.flags) + " " + typeof sign.name + ":" + String(sign.name) + " " + sign.id + " " + String(sign.members) + " " + ("exports" in sign) + " " + (sign instanceof Sign);
const flags: any[] = JSON.parse('[1, 2.5, -2147483648, 2147483647, 4294967296, "7", null, true, {"n": 1}, [3]]'); flags.push(undefined, NaN, -0);
const names: any[] = JSON.parse('["n", "", 7, null, {"n": 1}, [1], true, 2.5]'); names.push(undefined);
for (const flag of flags) for (const name of names) console.log(told(make(flag, name)));
for (const flag of flags) for (const name of names) { const sign = masked(flag, name); console.log(told(sign)); fill(sign, names); console.log(Object.keys(sign).join(), sign.parent === sign, sign.place); }
