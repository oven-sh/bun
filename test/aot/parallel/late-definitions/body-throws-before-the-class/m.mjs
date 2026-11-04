export const peek = () => { try { return typeof A; } catch (e) { return e.name; } };
globalThis.leaked = peek;
if (globalThis.leaked) throw new Error("stop");
class A {}
export const read = () => A;
