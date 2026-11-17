// A definition on `this` is a store where the callee is Object.defineProperty, under whatever name the program holds it. A member of another object that is called `defineProperty` defines nothing.
// RUN(HELD): link
// HELD: layout {{*}}kind=Instance name="Held" {{*}}key="hidden" {{*}}form=[IsReadOnly, IsNotEnumerable, IsNotConfigurable]
// RUN(OTHER): link
// OTHER: layout {{*}}kind=Instance name="Other" {{*}}key="size"
// OTHER-NOT: layout {{*}}kind=Instance name="Other" {{*}}key="hidden"

const define = Object.defineProperty;
function Held(value) {
  this.size = 1;
  define(this, "hidden", { value: value });
}
const other = {
  defineProperty(object, key, descriptor) {
    return [object, key, descriptor];
  },
};
function Other(value) {
  this.size = 1;
  other.defineProperty(this, "hidden", { value: value });
}
globalThis.keep = [new Held(1), new Other(2)];
console.log(Object.keys(globalThis.keep[0]).join(), globalThis.keep[0].hidden, Object.keys(globalThis.keep[1]).join(), globalThis.keep[1].hidden);
