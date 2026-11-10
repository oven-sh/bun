// Between births a setter comes to stand above one of the names, the function's prototype is replaced, and the function is constructed for another: the looks in front of the allocation fail where they must.
// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: what the allocation lists is held against what its slots take
interface Sign { flags: number; name: string; members?: object; exports?: object; links?: object; }
function Sign(this: Sign, flags: number, name: string) { this.flags = flags; this.name = name; this.members = undefined; this.exports = undefined; this.links = undefined; }
const Maker: new (flags: number, name: string) => Sign = Sign as any;
function make(flags: any, name: any) { return new Maker(flags, name); }
function fill(sign: Sign, value: object) { sign.members = value; sign.exports = value; sign.links = value; }
const given: any[] = JSON.parse('[[1, "a"], [2, 5], [3, "c"], [4.5, "d"], [5, null], [6, "f"], [7, "g"], [8, 9]]'); let calls = 0;
class Other { tag() { return "other"; } }
for (let i = 0; i < given.length; i++) {
    if (i === 2) Object.defineProperty((Sign as any).prototype, "exports", { set(value) { calls++; }, get() { return "above"; }, configurable: true });
    if (i === 4) delete (Sign as any).prototype.exports;
    if (i === 5) (Sign as any).prototype = { tag() { return "new"; } };
    const sign: any = i === 6 ? Reflect.construct(Sign, given[i], Other) : make(given[i][0], given[i][1]);
    console.log(i, Object.keys(sign).join(), String(sign.flags), String(sign.name), String(sign.exports), Object.hasOwn(sign, "exports"), calls, typeof sign.tag === "function" ? sign.tag() : "none", sign instanceof Maker);
    if (i & 1) { fill(sign, given); console.log(Object.keys(sign).join(), calls); }
}
