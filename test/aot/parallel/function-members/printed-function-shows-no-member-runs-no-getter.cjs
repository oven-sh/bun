// console.log names a function and opens nothing that lies on it: no getter runs and no member is asked how to print itself. A row of console.table does open it.
// Flags: --aot-validate
const custom = Symbol.for("nodejs.util.inspect.custom");
const ran = [];
const state = { reads: 0 };
function tagged() {}
tagged.member = {
  [custom]() {
    ran.push("member");
    return "opened";
  },
};
Object.defineProperty(tagged, "computed", {
  enumerable: true,
  get() {
    ran.push("getter");
    return ++state.reads;
  },
});
class Base {}
class Derived extends Base {
  static member = tagged.member;
  static get computed() {
    ran.push("static getter");
    return ++state.reads;
  }
}
const said = () => ran.join() || "nothing ran";

console.log(tagged, [tagged], { tagged }, new Map([[tagged, tagged]]), new Set([tagged]));
console.log(Derived, [Derived], async () => {}, function* steps() {}, tagged.bind(null));
console.log(said(), state.reads);
console.log("%o %O", tagged, Derived);
console.dir(tagged);
console.log(Bun.inspect(tagged), Bun.inspect({ Derived }), said(), state.reads);
console.table([tagged]);
console.log(said(), state.reads);
