// A key is defined with every attribute false on one object; a literal that holds the key and spreads that object creates an ordinary property.
const printValue = console.log;
{
    let out = "";
    function note(value) { out += (typeof value === "function" ? "function " + value.name : typeof value === "object" && value !== null ? JSON.stringify(value) : typeof value + " " + String(value)) + ";"; }
    function run1_3() { let o = Object.create({ nz7fqz: true }); note(Object.keys(o).join()); delete o.nz7fqz; o.nz7fqz += 1; delete o.nz7fqz; note(Reflect.ownKeys(o).length); { const { nz7fqz: read } = o; note(read); } }
    try { run1_3(); } catch (error) { note("threw " + (error)?.constructor?.name); }
    function run1_2() { let o = {}; o.n2np17 ||= 1; o.n2np17 = () => 1; if ("n2np17" in o) o.n2np17 = 2; { const { n2np17: taken, ...rest } = o; note(taken); o = rest; } delete o.mgb64i; o = { n2np17: 1.5, ...o }; note({ ...o }.n2np17); note(Object.keys(o).join()); }
    try { run1_2(); } catch (error) { note("threw " + (error)?.constructor?.name); }
    try { (() => { let o = { __proto__: { ns6k1q: 2147483648 } }; Object.defineProperty(o, "ns6k1q", { value: "t", writable: false, enumerable: false, configurable: false }); note("ns6k1q" in o); o = { ns6k1q: "", ...o }; note(Object.keys(o).join()); })(); } catch (error) { note("threw " + (error)?.constructor?.name); }
    printValue("steps 1", out);
}
export {};
