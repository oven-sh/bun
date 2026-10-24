// The read runs a getter of the source, or of what lies above it, with the source as `this`; the store runs a setter of the target or of what lies above it.
const lines = [];
const aboveSource = {
  get computed() {
    return this.base * 2;
  },
};
const source = Object.create(aboveSource);
source.base = 21;
Object.defineProperty(source, "own", {
  get() {
    lines.push("own is read");
    return () => "own";
  },
  enumerable: true,
});
const aboveTarget = {
  set base(value) {
    lines.push("base is set to " + value);
    this.kept = value + 1;
  },
};
const target = Object.create(aboveTarget);
for (const key in source) target[key] = source[key];
lines.push(Object.keys(target).sort().join(), target.kept, target.computed, target.own(), target.base);
source.base = 1;
lines.push(target.computed);

// "__proto__" as a name of the source: the store goes through the setter of Object.prototype.
const parsed = JSON.parse('{"__proto__": {"injected": 5}, "plain": 6}');
const victim = {};
for (const key of Object.keys(parsed)) victim[key] = parsed[key];
lines.push(Object.keys(victim).join(), victim.injected, victim.plain, Object.getPrototypeOf(victim) === parsed["__proto__"]);
console.log(lines.join("\n"));
