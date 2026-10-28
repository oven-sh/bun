// Loops over written names whose turns nest, leave, go on early, throw, change the name, share a variable, or define names that objects already have.
const out = [];
const t = {};
outer: for (const a of ["x", "y"]) {
  for (const name of ["p", "q", "r"]) {
    if (name === "q" && a === "x") continue outer;
    t[a + name] = () => a + name;
    t[name] = () => name + a;
  }
}
out.push(Object.keys(t).join(), t.p(), t.q(), t.r(), t.xp(), t.yq());
const u = {};
for (const name of ["a", "b"]) {
  try {
    u[name] = function () {
      return [name, arguments.length];
    };
    if (name === "a") throw name;
  } catch (e) {
    u["caught" + e] = () => e + name;
  } finally {
    u["done" + name] = () => name;
  }
}
out.push(Object.keys(u).join(), u.a(1, 2).join(), u.caughta(), u.donea(), u.doneb());
const v = {};
for (let name of ["m", "n"]) {
  name += "!";
  v[name] = () => name;
}
for (var w of ["s", "t"]) v[w] = () => w;
out.push(Object.keys(v).join(), v["m!"](), v.s(), v.t());
const g = {};
for (const name of ["gen", "asy"]) {
  g[name] = function* () {
    yield name;
    yield name.length;
  };
  g[name + "A"] = async () => name;
}
out.push([...g.gen()].join(), [...g.asy()].join());
let count = 0;
const c = {};
for (const name of ["i", "j"]) {
  let own = 0;
  c[name] = () => [name, ++own, ++count].join();
}
out.push(c.i(), c.i(), c.j());
const d = {};
for (const name of ["k", "k", "l"]) {
  const before = d[name];
  d[name] = () => (before ? before() + name : name);
}
out.push(d.k(), d.l());
const e = {};
for (const name of ["toString", "__proto__", "constructor", "0", "length", ""]) {
  Object.defineProperty(e, name, {
    get() {
      return "<" + name + ">";
    },
    configurable: true,
    enumerable: true,
  });
}
out.push(Object.getOwnPropertyNames(e).join("|"), e.toString, e.__proto__, e.constructor, e[0], e.length, e[""]);
function many(n) {
  const made = [];
  for (let i = 0; i < n; i++) {
    const o = {};
    ["h1", "h2"].forEach(name => {
      o[name] = () => name + i;
    });
    made.push(o);
  }
  return made.map(o => o.h1() + o.h2()).join();
}
out.push(many(3));
class K {}
for (const name of ["one", "two"])
  K.prototype[name] = function () {
    return name + (this instanceof K);
  };
for (const name of ["sone", "stwo"])
  K[name] = function () {
    return name + (this === K);
  };
out.push(new K().one(), new K().two(), K.sone(), K.stwo(), K.prototype.one.name, K.sone.name);
const f = {};
for (const name of ["z1", "z2"])
  f[name] = function self(n) {
    return n ? self(n - 1) + name : "";
  };
out.push(f.z1(2), f.z2(1), f.z1.name, String(f.z1) === String(f.z2), f.z1 !== f.z2);
g.genA().then(x => {
  out.push(x);
  console.log(out.join("\n"));
});
