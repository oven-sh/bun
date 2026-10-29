// The constructor above hands the object to other code by a setter, a getter, a closure, a field that holds a closure, a call, or the constructor between. That code fixes a name that the class below declares, so the definition of that name throws, and the field that was defined before it holds undefined.
const kept = [];
const out = [];
function fix(o) {
  kept.push(o);
  Object.defineProperty(o, "y", { value: "fixed" });
}
function run(f) {
  f();
}
class BySetter {
  constructor() {
    this.hook = 1;
  }
}
class BelowSetter extends BySetter {
  x;
  y;
  constructor(v) {
    super();
    this.x = v;
    this.y = "s";
  }
  set hook(v) {
    fix(this);
  }
}
class ByGetter {
  constructor() {
    this.peek;
  }
}
class BelowGetter extends ByGetter {
  x;
  y;
  constructor(v) {
    super();
    this.x = v;
    this.y = "s";
  }
  get peek() {
    fix(this);
    return 1;
  }
}
class ByClosure {
  constructor() {
    run(() => fix(this));
  }
}
class BelowClosure extends ByClosure {
  x;
  y;
  constructor(v) {
    super();
    this.x = v;
    this.y = "s";
  }
}
class ByField {
  self = this;
  later = () => fix(this);
  constructor() {
    this.later();
  }
}
class BelowField extends ByField {
  x;
  y;
  constructor(v) {
    super();
    this.x = v;
    this.y = "s";
  }
}
class Frozen {
  a = 1;
  constructor() {
    Object.freeze(this);
    kept.push(this);
  }
}
class BelowFrozen extends Frozen {
  x;
  y;
  constructor(v) {
    super();
    this.x = v;
    this.y = "s";
  }
}
class Top {
  a;
  constructor() {
    this.a = 1;
  }
}
class Between extends Top {
  b;
  constructor() {
    super();
    this.b = 2;
    fix(this);
  }
}
class BelowBetween extends Between {
  x;
  y;
  constructor(v) {
    super();
    this.x = v;
    this.y = "s";
  }
}
class Quiet {
  a;
  constructor() {
    this.a = 1;
  }
}
class BelowQuiet extends Quiet {
  x;
  y;
  constructor(v) {
    super();
    this.x = v;
    this.y = "s";
  }
}
for (const C of [BelowSetter, BelowGetter, BelowClosure, BelowField, BelowFrozen, BelowBetween, BelowQuiet]) {
  const before = kept.length;
  try {
    out.push(C.name + " made " + JSON.stringify(new C(1)));
  } catch (e) {
    const o = kept.length > before ? kept[kept.length - 1] : undefined;
    out.push(C.name + " " + e.constructor.name + " " + (o ? String(o.x) + " " + Object.keys(o).join() : "not kept"));
  }
}
console.log(out.join("\n"));
