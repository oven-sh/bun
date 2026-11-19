const seed = Number(process.argv[2] ?? 3);
const held = { count: seed };
const map = { box: { value: held, writable: true, enumerable: true, configurable: true }, size: { get() { return held.count; } } };
function Target() {}
Object.defineProperties(Target.prototype, map);
const t = new Target();
t.box.count = "text";
t.box.more = [1, 2];
console.log(held.count + 1, t.size + 1, held.more.length, Object.keys(held).join());
