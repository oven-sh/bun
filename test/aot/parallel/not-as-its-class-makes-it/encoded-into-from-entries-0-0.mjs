// Own value 0 of what is made (encoded into) comes out by from entries.
function use(e) { return typeof e; }
const m = new TextEncoder().encodeInto("a", new Uint8Array(2));
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }
