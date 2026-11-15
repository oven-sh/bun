// A spread asks the trap about every own key of the target, and one key of Buffer.prototype is the symbol that the host looks under.
const seen = [];
const watched = new Proxy(Buffer.prototype, { getOwnPropertyDescriptor(target, key) { seen.push(key); } });
try { ({ ...watched }); } catch {}
const mine = {};
for (const key of seen) mine[key] = () => "printed by the method";
console.log(seen.length > 0, mine);
