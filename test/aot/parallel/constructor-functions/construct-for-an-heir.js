// `Reflect.construct(Parent, list, Heir)` runs the parent's body on an object with the heir's prototype. The heir's own body never runs on it, whatever every `new Heir` stores.
const show = (label, o) =>
  console.log(
    label,
    Object.keys(o).join(),
    JSON.stringify(o),
    String(o.extra),
    "extra" in o,
    Object.hasOwn(o, "extra"),
    JSON.stringify({ ...o }),
    JSON.stringify(Object.getOwnPropertyDescriptor(o, "extra") ?? null),
  );

function Meter(size) { this.size = size; this.n = 0; }
function Sub(size) { Meter.call(this, size); this.extra = "x"; }
Sub.prototype = Object.create(Meter.prototype);
Sub.prototype.read = function () { return this.extra + ":" + this.size; };
show("an heir", new Sub(2));
const built = Reflect.construct(Meter, [9], Sub);
show("built for it", built);
console.log(built instanceof Sub, built instanceof Meter, built.read());
built.extra = 7;
show("stored later", built);
show("an heir again", new Sub(3));

function Deep(size) { Sub.call(this, size); this.deep = true; }
Deep.prototype = Object.create(Sub.prototype);
show("two below", new Deep(1));
for (const o of [Reflect.construct(Meter, [4], Deep), Reflect.construct(Sub, [5], Deep)]) {
  show("built for two below", o);
  console.log(String(o.deep), "deep" in o, o instanceof Deep, o.read());
}

// The heir always fills a field that the parent fills now and then.
function Sometimes(on) { if (on) this.extra = "parent"; this.always = 1; }
function Always(on) { Sometimes.call(this, on); this.extra = "heir"; }
Always.prototype = Object.create(Sometimes.prototype);
show("always", new Always(false));
show("now", Reflect.construct(Sometimes, [true], Always));
show("and then", Reflect.construct(Sometimes, [false], Always));

// The heir does not call the parent.
function Alone() { this.extra = 1; this.own = 2; }
Alone.prototype = Object.create(Meter.prototype);
show("alone", new Alone());
show("built for alone", Reflect.construct(Meter, [6], Alone));

// What compilers write for `super(..)` in a class that they turn into functions, beside a store to `this`.
function Below(a) { var self = Reflect.construct(Meter, [a], Below); self.extra = a; this.lost = 1; return self; }
Below.prototype = Object.create(Meter.prototype);
for (let i = 0; i < 3; i++) show("below", new Below(i));
show("built for below", Reflect.construct(Meter, [8], Below));

// In a loop, so that the call is hot, and with the heirs made behind it.
function Late(size) { Meter.call(this, size); this.extra = "late"; }
Late.prototype = Object.create(Meter.prototype);
let seen = 0;
for (let i = 0; i < 2000; i++) {
  const o = Reflect.construct(Meter, [i], Late);
  if ("extra" in o || o.extra !== undefined || Object.keys(o).length !== 2) seen++;
}
console.log("hot", seen);
show("late", new Late(1));
