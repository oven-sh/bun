// An object is born at the top of its row of classes: the highest class that lists a name makes the field, so the name has that class's form in every class below, whatever the heir's own stores say.
// RUN(DEFINES): link
// DEFINES: layout {{*}}kind=Instance name="HeirThatDefines" {{*}}key="mark"
// DEFINES-NOT: layout {{*}}kind=Instance name="HeirThatDefines" {{*}}form=[
// RUN(STORES): link
// STORES: layout {{*}}kind=Instance name="HeirThatStores" {{*}}key="mark" {{*}}form=[IsNotEnumerable, IsNotConfigurable]
// RUN(LOWEST): link
// LOWEST: layout {{*}}kind=Instance name="Lowest" {{*}}key="mark"
// LOWEST-NOT: layout {{*}}kind=Instance name="Lowest" {{*}}form=[
// RUN(ALONE): link
// ALONE: layout {{*}}kind=Instance name="HeirAlone" {{*}}key="other" {{*}}form=[IsReadOnly, IsNotEnumerable, IsNotConfigurable]

class PlainBase {
  constructor(n) {
    this.mark = n;
    this.size = n + 1;
  }
}
class HeirThatDefines extends PlainBase {
  constructor(n) {
    super(n);
    Object.defineProperty(this, "mark", { value: n + 2 });
  }
}
class Lowest extends HeirThatDefines {
  constructor(n) {
    super(n);
    Object.defineProperty(this, "mark", { value: n + 3 });
  }
}
class HiddenBase {
  constructor(n) {
    Object.defineProperty(this, "mark", { value: n, writable: true });
    this.size = n + 1;
  }
}
class HeirThatStores extends HiddenBase {
  constructor(n) {
    super(n);
    this.mark = n + 2;
  }
}
class HeirAlone extends PlainBase {
  constructor(n) {
    super(n);
    Object.defineProperty(this, "other", { value: n });
  }
}
globalThis.keep = [new PlainBase(1), new HeirThatDefines(2), new Lowest(3), new HiddenBase(4), new HeirThatStores(5), new HeirAlone(6)];
console.log(globalThis.keep.map(row => Object.keys(row).join() + ":" + row.mark + ":" + row.other).join(" "));
