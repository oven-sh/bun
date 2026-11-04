class Links { flags = 0; type?: string; target?: Links; size() { return 1; } }
interface Options { name: string; limit?: number; label?: string }
function typeOf(l: Links) { return l.type; }
function both(l: Links) { return [l.type, l.target === undefined, l.flags]; }
function truth(l: Links) { return l.type ? "there" : "not there"; }
function orElse(l: Links) { return l.type || (l.type = "made"); }
function limitOf(o: Options) { return o.limit; }
function show(l: Links) { return JSON.stringify([typeOf(l), both(l), truth(l)]); }
const l = new Links(); console.log(show(l)); Object.setPrototypeOf(l, { size() { return 2; } });
for (let i = 0; i < 3; i++) console.log(show(l));
try { console.log(orElse(l), show(l)); } catch (e) { console.log("threw", (e as Error).name, show(l)); }
export {};
