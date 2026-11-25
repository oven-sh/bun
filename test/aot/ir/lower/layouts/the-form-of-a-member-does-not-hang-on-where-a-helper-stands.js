// Whichever store makes a field gives it its form: the earliest one that runs in every construction, wherever another store of the name stands in the file. A helper's store runs where the helper is handed `this`. Without such a store the stores of the name must agree, or the field is a plain one.
// RUN(ABOVE): link
// ABOVE: layout {{*}}kind=Instance name="Above" {{*}}fields=[{key="mark" {{*}}flags=[IsRequired]}, {key="size"
// RUN(BELOW): link
// BELOW: layout {{*}}kind=Instance name="Below" {{*}}fields=[{key="mark" {{*}}flags=[IsRequired]}, {key="size"
// RUN(METHOD): link
// METHOD: layout {{*}}kind=Instance name="Method" {{*}}fields=[{key="mark" {{*}}flags=[IsRequired]}, {key="size"
// RUN(BORN): link
// BORN: layout {{*}}kind=Instance name="Born" {{*}}key="mark" {{*}}form=[IsReadOnly, IsNotEnumerable, IsNotConfigurable]
// RUN(AGREED): link
// AGREED: layout {{*}}kind=Instance name="Agreed" {{*}}key="mark" {{*}}form=[IsReadOnly, IsNotEnumerable, IsNotConfigurable]
// RUN(TORN): link
// TORN: layout {{*}}kind=Instance name="Torn" {{*}}key="mark"
// TORN-NOT: layout {{*}}kind=Instance name="Torn" {{*}}form=[
// RUN(LAID): link
// LAID: layout {{*}}kind=Instance name="Laid" {{*}}key="mark" {{*}}form=[IsNotEnumerable, IsNotConfigurable]
// RUN(FIRST): link
// FIRST: layout {{*}}kind=Instance name="LaidFirst" {{*}}key="mark" {{*}}form=[IsNotEnumerable, IsNotConfigurable]
// RUN(LATER): link
// LATER: layout {{*}}kind=Instance name="LaidLater" {{*}}key="mark"
// LATER-NOT: layout {{*}}kind=Instance name="LaidLater" {{*}}form=[

function hideAbove(row) {
  Object.defineProperty(row, "mark", { value: 7 });
}
class Above {
  constructor(n) {
    this.mark = n;
    this.size = n + 1;
  }
  seal() {
    hideAbove(this);
  }
}
class Below {
  constructor(n) {
    this.mark = n;
    this.size = n + 1;
  }
  seal() {
    hideBelow(this);
  }
}
function hideBelow(row) {
  Object.defineProperty(row, "mark", { value: 7 });
}
class Method {
  seal() {
    Object.defineProperty(this, "mark", { value: 7 });
  }
  constructor(n) {
    this.mark = n;
    this.size = n + 1;
  }
}
class Born {
  constructor(n) {
    Object.defineProperty(this, "mark", { value: n });
    this.size = n + 1;
  }
  loosen() {
    this.mark = 0;
  }
}
class Agreed {
  constructor(n) {
    this.size = n + 1;
  }
  seal() {
    Object.defineProperty(this, "mark", { value: 7 });
  }
  sealOtherwise() {
    Object.defineProperty(this, "mark", { value: 8 });
  }
}
class Torn {
  constructor(n) {
    this.size = n + 1;
  }
  seal() {
    Object.defineProperty(this, "mark", { value: 7 });
  }
  write() {
    this.mark = 8;
  }
}
class Laid {
  constructor(n) {
    lay(this, n);
    this.size = n + 1;
  }
  loosen() {
    this.mark = 0;
  }
}
class LaidFirst {
  constructor(n) {
    lay(this, n);
    this.mark = n + 2;
    this.size = n + 1;
  }
}
class LaidLater {
  constructor(n) {
    this.mark = n + 2;
    lay(this, n);
    this.size = n + 1;
  }
}
function lay(row, n) {
  Object.defineProperty(row, "mark", { value: n, writable: true });
}
globalThis.keep = [new Above(1), new Below(2), new Method(3), new Born(4), new Agreed(5), new Torn(6), new Laid(7), new LaidFirst(8), new LaidLater(9)];
console.log(globalThis.keep.map(row => Object.keys(row).join() + ":" + row.mark).join(" "));
