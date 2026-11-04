// A proxy is made and used in one function over a target that is frozen, sealed or closed: what its traps answer is held against the target, and an answer that the target forbids throws.
function attempt(f) {
  try {
    return String(f());
  } catch (e) {
    return e.name;
  }
}
function deed(close, answer) {
  const target = close({ x: 1 });
  const p = new Proxy(target, {
    get: () => answer,
    set: () => true,
    has: () => false,
    deleteProperty: () => true,
    getOwnPropertyDescriptor: () => undefined,
  });
  return [
    attempt(() => p.x),
    attempt(() => p.y),
    attempt(() => {
      p.x = answer;
      return "stored";
    }),
    attempt(() => "x" in p),
    attempt(() => "y" in p),
    attempt(() => delete p.x),
    attempt(() => Object.hasOwn(p, "x")),
    attempt(() => Object.hasOwn(p, "y")),
  ].join(" ");
}
const ways = [o => o, Object.freeze, Object.seal, Object.preventExtensions];
for (let i = 0; i < ways.length; i++) console.log(i, deed(ways[i], 1), "|", deed(ways[i], 2));
let last = "";
for (let i = 0; i < 200; i++) last = deed(ways[i % 4], i % 2);
console.log(last);
