// `flags` is read on two receivers at one place. One is an instance of a class below RegExp that has flag getters of its own: the getter of RegExp.prototype reads each of them.
// The other is a function of the host, and the program sets the prototype of an object that came out of a module named at run time.
const seen = [];
class Special extends RegExp {
  get hasIndices() {
    seen.push("hasIndices");
    return super.hasIndices;
  }
  get global() {
    seen.push("global");
    return super.global;
  }
  get ignoreCase() {
    seen.push("ignoreCase");
    return super.ignoreCase;
  }
  get multiline() {
    seen.push("multiline");
    return super.multiline;
  }
  get dotAll() {
    seen.push("dotAll");
    return super.dotAll;
  }
  get unicode() {
    seen.push("unicode");
    return super.unicode;
  }
  get unicodeSets() {
    seen.push("unicodeSets");
    return super.unicodeSets;
  }
  get sticky() {
    seen.push("sticky");
    return super.sticky;
  }
}
const special = new Special("a", "gs");
const load = Reflect.get(process, "getBuiltinModule");
const whole = load(["node:", "events"].join(""));
const made = new whole[["EventE", "mitter"].join("")]();
Object.setPrototypeOf(made, Object.getPrototypeOf(made));
for (const each of [load, special]) console.log(each.flags, seen.join());
