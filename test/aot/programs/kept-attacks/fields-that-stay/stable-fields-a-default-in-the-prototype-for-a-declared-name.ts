// A declared name that seen code also stores into the prototype object: an instance without an own property of that name reads the default from the prototype, as in plain Bun.
interface Shape { level?: number; name: string }
function Maker(this: Shape, level?: number) {
  this.name = "made";
  if (level !== undefined) this.level = level;
}
Maker.prototype.level = 7;
class Holder {
  declare level?: number;
  name: string = "held";
  constructor(level?: number) { if (level !== undefined) this.level = level; }
}
(Holder.prototype as any).level = 8;
const show = (label: string, o: Shape) => console.log(label + ":", o.level, "level" in o, Object.hasOwn(o, "level"), Object.keys(o).join(), JSON.stringify(o));
function levelOf(o: Shape) { return o.level; }
const makers: [string, (level?: number) => Shape][] = [
  ["what a constructor function makes", level => new (Maker as any)(level)],
  ["a class instance", level => new Holder(level)],
];
for (const [how, make] of makers) {
  const without = make();
  const withOwn = make(1);
  show(how + ", without its own", without);
  show(how + ", with its own", withOwn);
  console.log("  read by typed code:", levelOf(without), levelOf(withOwn));
  delete withOwn.level;
  show("  deleted", withOwn);
  without.level = 2;
  show("  stored", without);
  without.level = undefined;
  show("  undefined stored", without);
}
