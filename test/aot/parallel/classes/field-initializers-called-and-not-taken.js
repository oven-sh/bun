// The function that stores the initial values of a class's fields, where it is too long to be taken into the constructor: what its object looks like to everybody who meets it
// while it is being made, and afterwards.
const lines = [];
const seen = [];
function show(label, value) {
  lines.push(label + ": " + JSON.stringify(value));
}
function describe(object) {
  return Object.getOwnPropertyNames(object).map(name => {
    const d = Object.getOwnPropertyDescriptor(object, name);
    return name + (d.get ? "=get" : "=" + String(typeof d.value === "function" ? "fn" : d.value)) + (d.writable === false ? "!w" : "") + (d.configurable === false ? "!c" : "");
  }).join(",");
}
function look(object, tag) {
  seen.push(tag + "[" + describe(object) + "]");
  return tag;
}

class Wide {
  a0 = 0; a1 = 1; a2 = 2; a3 = 3; a4 = 4; a5 = 5; a6 = 6; a7 = 7; a8 = 8; a9 = 9;
  #p0 = 10; #p1 = 11; #p2; #p3 = "x";
  f0 = () => this.a0 + this.#p0; f1 = () => this.a1 + this.#p1; f2 = () => this.#p2; f3 = () => this.#p3 + this.a3;
  f4 = v => { this.a4 = v; return this; }; f5 = v => { this.#p2 = v; return this; };
  f6 = () => [this.a5, this.a6, this.a7]; f7 = () => ({ a: this.a8, b: this.a9 });
  b0 = { n: 0 }; b1 = [1, 2, 3]; b2 = "text"; b3 = null; b4; b5 = 1.5; b6 = true; b7 = -0;
  constructor(first, options) {
    this.first = first;
    if (options) {
      this.a0 = options.a0;
      this.#p2 = options.p2;
    }
  }
  sum() { return this.f0() + this.f1() + this.a2 + this.b1.length; }
}

class Below extends Wide {
  c0 = this.a0 + 100; c1 = this.f1(); c2 = "c"; #q = this.sum(); c3 = () => this.#q; c4 = [this.first];
  c5 = 5; c6 = 6; c7 = 7; c8 = 8; c9 = 9; d0 = 0; d1 = 1; d2 = 2; d3 = 3; d4 = 4; d5 = 5; d6 = 6; d7 = 7; d8 = 8; d9 = 9;
  constructor(first, options) {
    super(first, options);
    this.last = this.c3();
  }
}

class Leaks {
  x = 1; y = look(this, "afterX"); z = 3; w = look(this, "afterZ");
  e0 = 0; e1 = 1; e2 = 2; e3 = 3; e4 = 4; e5 = 5; e6 = 6; e7 = 7; e8 = 8; e9 = 9;
  g0 = () => this.x; g1 = () => this.y; g2 = () => this.z; g3 = () => this.w; g4 = () => this.e0; g5 = () => this.e1;
}

function removeX(object) { delete object.x; return "removed"; }
class LosesField {
  x = 1; y = removeX(this); z = 3;
  h0 = 0; h1 = 1; h2 = 2; h3 = 3; h4 = 4; h5 = 5; h6 = 6; h7 = 7; h8 = 8; h9 = 9;
  k0 = () => this.x; k1 = () => this.y; k2 = () => this.z; k3 = () => this.h0; k4 = () => this.h1; k5 = () => this.h2;
}

function makeAccessor(object) { Object.defineProperty(object, "x", { get() { return "got"; }, configurable: true, enumerable: true }); return "accessor"; }
class GetsAccessor {
  x = 1; y = makeAccessor(this); z = 3;
  m0 = 0; m1 = 1; m2 = 2; m3 = 3; m4 = 4; m5 = 5; m6 = 6; m7 = 7; m8 = 8; m9 = 9;
  n0 = () => this.x; n1 = () => this.y; n2 = () => this.z; n3 = () => this.m0; n4 = () => this.m1; n5 = () => this.m2;
}

function freeze(object) { Object.freeze(object); return "frozen"; }
class FrozenHalfway {
  x = 1; y = 2; z = freeze(this); late = 4;
  o0 = 0; o1 = 1; o2 = 2; o3 = 3; o4 = 4; o5 = 5; o6 = 6; o7 = 7; o8 = 8; o9 = 9;
}

function addExtra(object) { object.extra = "extra"; return "added"; }
class GetsExtra {
  x = 1; y = addExtra(this); z = 3;
  r0 = 0; r1 = 1; r2 = 2; r3 = 3; r4 = 4; r5 = 5; r6 = 6; r7 = 7; r8 = 8; r9 = 9;
  s0 = () => this.extra; s1 = () => this.x; s2 = () => this.z; s3 = () => this.r0; s4 = () => this.r1; s5 = () => this.r2;
}

class Throws {
  x = 1; y = 2; z = (() => { if (Throws.fail) { Throws.kept = this; throw new Error("no"); } return 3; })(); w = 4;
  t0 = 0; t1 = 1; t2 = 2; t3 = 3; t4 = 4; t5 = 5; t6 = 6; t7 = 7; t8 = 8; t9 = 9;
  u0 = () => this.x; u1 = () => this.w; u2 = () => this.z; u3 = () => this.t0; u4 = () => this.t1; u5 = () => this.t2;
}

function Stamp(object) { return object; }
class Stamped extends Stamp {
  v0 = 0; v1 = 1; #mark = "marked"; v2 = 2; v3 = 3; v4 = 4; v5 = 5; v6 = 6; v7 = 7; v8 = 8; v9 = 9;
  static read(object) { return #mark in object ? object.#mark : "none"; }
}

let total = 0;
for (let i = 0; i < 300; i++) {
  const wide = new Wide(i, i % 3 ? { a0: i, p2: "p" + i } : undefined);
  total += wide.sum() + wide.f6().length + wide.f7().b;
  wide.f4(i).f5(i * 2);
  total += wide.a4 + wide.f2();
  const below = new Below(i, i % 2 ? { a0: 7, p2: 8 } : null);
  total += below.last + below.c0 + below.c1 + below.c4[0] + below.d9;
}
show("total", total);
show("wide", describe(new Wide("w", { a0: "A", p2: "P" })));
show("below", describe(new Below("b")));
show("keys of below", Object.keys(new Below("b")).length);

const leaks = new Leaks();
show("leaks", [describe(leaks), leaks.g1(), leaks.g3()]);
show("seen", seen);

const loses = [new LosesField(), new LosesField()];
show("loses", loses.map(o => [describe(o), o.k0(), "x" in o, o.k2()]));
loses[0].x = "again";
show("loses again", [Object.keys(loses[0]).slice(-2), loses[0].k0()]);

const accessor = new GetsAccessor();
show("accessor", [describe(accessor), accessor.n0(), accessor.x]);

let frozenError = "none";
try { new FrozenHalfway(); } catch (error) { frozenError = error.constructor.name; }
show("frozen", frozenError);

const extra = new GetsExtra();
show("extra", [describe(extra), extra.s0(), Object.keys(extra).indexOf("extra")]);

show("throws not", describe(new Throws()));
Throws.fail = true;
let thrown = "none";
try { new Throws(); } catch (error) { thrown = error.message; }
show("throws", [thrown, describe(Throws.kept), "w" in Throws.kept, Throws.kept.w]);
Throws.kept.w = "late";
Throws.kept.z = "later";
show("kept", [describe(Throws.kept), Object.keys(Throws.kept)]);

const plain = { own: 1 };
const stamped = new Stamped(plain);
show("stamped", [stamped === plain, describe(plain), Stamped.read(plain), Stamped.read({})]);
const wideStamped = new Stamped(new Wide("s"));
show("stamped wide", [Object.keys(wideStamped).length, Stamped.read(wideStamped), wideStamped.sum()]);

show("reflect", describe(Reflect.construct(Wide, ["r"], Below)).length);
show("reflect prototype", Object.getPrototypeOf(Reflect.construct(Wide, ["r"], Below)) === Below.prototype);

console.log(lines.join("\n"));
