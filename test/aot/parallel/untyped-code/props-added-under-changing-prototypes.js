// Functions made at run time add a property to fresh objects, hundreds of times, so that whatever is remembered about the prototype chain is remembered.
// Then the chain changes: a setter, a read-only property, another prototype, a proxy, far up or near; and changes back. Every store must see it at once.
const lines = [];
const makers = { sloppy: body => new Function("target", "value", body), strict: body => new Function("target", "value", "'use strict'; " + body) };
const warm = 300;
for (const [mode, maker] of Object.entries(makers)) {
  const add = maker("target.held = value; return target;");
  const addTwo = maker("target.first = value; target.held = value; target.last = value; return target;");
  const show = made => Object.keys(made).join(",") + "/" + String(made.held);
  const attempt = (store, fresh, value) => { try { return show(store(fresh(), value)); } catch (error) { return error.name; } };
  const chainOf = depth => { const chain = [{}]; for (let i = 1; i < depth; i++) chain.push(Object.create(chain[i - 1])); return chain; };
  for (const depth of [1, 2, 4]) {
    for (const at of [0, depth - 1]) {
      const chain = chainOf(depth), nearest = chain[depth - 1], changed = chain[at];
      const fresh = () => Object.create(nearest);
      const seen = [];
      const say = what => lines.push(mode + " depth " + depth + " at " + at + " " + what + ": " + attempt(add, fresh, 1) + " " + attempt(addTwo, fresh, 2) + " " + attempt(add, fresh, 3) + (seen.length ? " seen " + seen.splice(0).join(",") : ""));
      const warmUp = () => { for (let turn = 0; turn < warm; turn++) { add(fresh(), turn); addTwo(fresh(), turn); } };
      warmUp(); say("untouched");
      Object.defineProperty(changed, "held", { set(v) { seen.push(v); }, configurable: true }); say("a setter");
      warmUp(); seen.length = 0; say("a setter, warm");
      delete changed.held; say("the setter gone");
      warmUp(); say("gone, warm");
      Object.defineProperty(changed, "held", { value: "fixed", writable: false, configurable: true }); say("read-only");
      Object.defineProperty(changed, "held", { value: "loose", writable: true, configurable: true }); say("writable");
      delete changed.held; warmUp(); say("gone again, warm");
      Object.defineProperty(changed, "held", { get() { return "got"; }, configurable: true }); say("a getter alone");
      delete changed.held; warmUp();
      changed.other = 1; say("another name");
      warmUp();
      const above = { set held(v) { seen.push("above " + v); } };
      const before = Object.getPrototypeOf(changed);
      Object.setPrototypeOf(changed, above); say("another prototype");
      Object.setPrototypeOf(changed, before); say("the old prototype"); warmUp();
      Object.setPrototypeOf(changed, new Proxy({}, { set(target, key, value) { seen.push("proxy " + String(key)); return true; } })); say("a proxy above");
      Object.setPrototypeOf(changed, null); say("nothing above"); warmUp(); say("nothing above, warm");
      Object.preventExtensions(changed); say("the changed one takes no more");
    }
  }
  const classes = maker("target.held = value; return target;");
  class Base {} class Middle extends Base {} class Leaf extends Middle {}
  for (let turn = 0; turn < warm; turn++) { classes(new Leaf(), turn); classes(new Middle(), turn); }
  lines.push(mode + " classes: " + show(classes(new Leaf(), 1)) + " " + show(classes(new Middle(), 2)));
  let caught = 0;
  Object.defineProperty(Base.prototype, "held", { set(v) { caught += v; }, configurable: true });
  lines.push(mode + " classes with a setter at the root: " + show(classes(new Leaf(), 10)) + " " + show(classes(new Middle(), 20)) + " " + caught);
  delete Base.prototype.held;
  lines.push(mode + " classes without it: " + show(classes(new Leaf(), 1)) + " " + show(classes(new Middle(), 2)));
  const plain = maker("target.held = value; return target;");
  for (let turn = 0; turn < warm; turn++) plain({}, turn);
  lines.push(mode + " plain objects: " + show(plain({}, 1)) + " " + show(plain({ a: 1 }, 2)) + " " + attempt(plain, () => Object.preventExtensions({}), 3) + " " + attempt(plain, () => Object.create(null), 4) + " " + attempt(plain, () => [], 5));
}
console.log(lines.join("\n"));
