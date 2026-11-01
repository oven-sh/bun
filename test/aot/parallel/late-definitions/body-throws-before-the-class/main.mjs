// A read that comes before the declaration has run finds the dead zone, or undefined, and not the object that is made late.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
try { await import("./m.mjs"); } catch (e) { console.log("import failed:", e.message); }
say(() => globalThis.leaked());
