// Reading a static private accessor that has only a setter throws a TypeError.
class C { static set #s(v) {} static read() { return C.#s; } }
try { console.log(String(C.read())); } catch (e) { console.log("threw " + e.name); }
