let everythingPrinted = "";
function shownInTheText(value) { return (typeof value === "object" && value !== null) || typeof value === "function" || typeof value === "symbol" ? typeof value : String(value); }
function printValue(...values) { for (const value of values) everythingPrinted += shownInTheText(value) + " "; everythingPrinted += "\n"; }
{
    let out = "";
    function note(value) { out += (typeof value === "symbol" ? "symbol" : typeof value === "function" ? "function" : typeof value === "object" && value !== null ? "object" : typeof value + " " + String(value)) + ";"; }
    try { new Set(["s"]).forEach((a1_4, b1_4, c1_4) => { try { note(Object.isFrozen(c1_4)); } catch (error) { note("threw " + (error)?.constructor?.name); } }); } catch (error) { note("threw " + (error)?.constructor?.name); }
    try { "aba".replaceAll("a", (a1_3, b1_3, c1_3) => { note(typeof c1_3?.prototype); note(c1_3); return ""; }); } catch (error) { note("threw " + (error)?.constructor?.name); }
    try { JSON.stringify({ k: [1] }, function (a1_2, b1_2) { try { note(Reflect.ownKeys(Object(b1_2)).length); } catch (error) { note("threw " + (error)?.constructor?.name); } try { { class C1_2_1 extends b1_2 {} const made = new C1_2_1(); note(made); } } catch (error) { note("threw " + (error)?.constructor?.name); } return b1_2; }); } catch (error) { note("threw " + (error)?.constructor?.name); }
    try { (({ proxy: a1_1, revoke: b1_1 }) => { { const made = Reflect.construct(Object, [], b1_1); note(made); } note(Object.prototype.toString.call(b1_1)); { const made = Reflect.construct(Object, [], b1_1); note(made); } })(Proxy.revocable({}, {})); } catch (error) { note("threw " + (error)?.constructor?.name); }
    printValue("handed to callbacks 1", out);
}
{
    let out = "";
    function note(value) { out += (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)) + ";"; }
    class Answers2 { constructor(given) { return given; } }
    class Stamps2 extends Answers2 { #p = 1; static has(given) { return #p in given; } }
    const key2_2 = ["knjeso", "larqrt"].join("");
    const o2_2 = {};
    
    Object.preventExtensions(o2_2);
    const c2_2 = { ...{ ...o2_2 } };
    try { c2_2[0] = "index"; note("stored"); } catch (error) { note("threw"); }
    note(Reflect.set(c2_2, 9, 1)); note(Reflect.defineProperty(c2_2, 11, { value: 1, enumerable: true })); note(Object.isExtensible(c2_2)); note(Object.isFrozen(c2_2)); note(Stamps2.has(c2_2)); note(Stamps2.has(o2_2));
    try { c2_2.named = 1; c2_2.a = 5; delete c2_2[key2_2]; } catch (error) { note("threw"); }
    note(Object.keys(c2_2).join()); note(Object.getOwnPropertyDescriptors(c2_2)); note(Object.keys(o2_2).join());
    const key2_1 = ["kyyl3", "l32zi"].join("");
    const o2_1 = {};
    o2_1[key2_1] = 2;
    Object.preventExtensions(o2_1);
    const c2_1 = { 1: 1, ...o2_1 };
    try { c2_1[4294967294] = "index"; note("stored"); } catch (error) { note("threw"); }
    note(Reflect.set(c2_1, 9, 1)); note(Reflect.defineProperty(c2_1, 11, { value: 1, enumerable: true })); note(Object.isExtensible(c2_1)); note(Object.isFrozen(c2_1)); note(Stamps2.has(c2_1)); note(Stamps2.has(o2_1));
    try { c2_1.named = 1; c2_1.a = 5; delete c2_1[key2_1]; } catch (error) { note("threw"); }
    note(Object.keys(c2_1).join()); note(Object.getOwnPropertyDescriptors(c2_1)); note(Object.keys(o2_1).join());
    printValue("copies 2", out);
}
{
    let out = "";
    function note(value) { out += (typeof value === "function" ? "function " + value.name : typeof value === "object" && value !== null ? JSON.stringify(value) : typeof value + " " + String(value)) + ";"; }
    function run3_2(y) { const o = { npb8m3() { return 1; } }; Reflect.deleteProperty(o, "npb8m3"); note(o.npb8m3?.call?.(o)); note(Object.values(o).length); }
    try { run3_2(0); } catch (error) { note("threw " + (error)?.constructor?.name); } try { run3_2(() => 2); } catch (error) { note("threw " + (error)?.constructor?.name); }
    function run3_1(y) { const o = { n1bi6p: class {} }; Object.assign(o, { n1bi6p: y }); new Proxy(o, { set(target, key, value) { return Reflect.set(target, key, value); } }).n1bi6p = y; note({ ...o }.n1bi6p); note(Object.values(o).length); }
    for (const y of [10n, [1], () => 2]) { try { run3_1(y); } catch (error) { note("threw " + (error)?.constructor?.name); } }
    printValue("natives 3", out);
}
console.log(everythingPrinted);
export {};
import { stat as statOfNodeFs } from "node:fs";
statOfNodeFs(".", () => {});
