// Each form of text that follows from constants, with closures over what changes.
const out = [];
function say(...a) { console.log(...a.map(x => typeof x === "function" ? x.toString() : x)); }
var shared = 1;
function forms() {
  let local = 10;
  const pieces = ["value", "+", "shared", "+", "local"];
  const f = eval("(function join(value) { return " + pieces.join(" ") + "; })");
  const g = eval(`(function () { local = local + 1; shared++; return local; })`);
  const h = eval("(" + "(a, b = 2, ...c) => a + b + c.length" + ")");
  const gen = eval("(function* gen(n) { for (let i = 0; i < n; i++) yield i + local; })");
  const asy = eval("(async function asy(x) { return (await x) + local; })");
  say(f, f(1), g(), f(1), g(), f(1), h(1), h(1, 1, 1, 1), [...gen(3)].join());
  asy(Promise.resolve(5)).then(v => say("async", v));
  local = 100;
  say(f(1), f.name, f.length, g.name, g.length, h.name, h.length, gen.name, asy.name, asy);
  return { f, g };
}
const one = forms(), two = forms();
say(one.f === two.f, one.f(1), two.f(1), one.g(), two.g(), one.f(1), two.f(1), shared);
// replace, split, map, loops, objects
function makers(proto) {
  var template = "(function %name%(x) { return x %op% %by%; })";
  var ops = { add: "+", sub: "-", mul: "*" };
  for (var name in ops) {
    var text = template.replace("%name%", name).replace(/%op%/g, ops[name]).split("%by%").join("2");
    proto[name] = eval(text);
  }
  Object.keys(ops).map(k => k.toUpperCase()).forEach(k => {
    proto[k] = eval("(function " + k + "(x) { return this." + k.toLowerCase() + "(x) + 1; })");
  });
  for (let i = 0; i < 3; i++) proto["n" + i] = eval("(function() { return " + i + " * " + `${i + 1}` + "; })");
  return proto;
}
const p = makers({});
say(Object.keys(p).join(), p.add(5), p.sub(5), p.mul(5), p.ADD(5), p.SUB(5), p.MUL(5), p.n0(), p.n1(), p.n2());
for (const k of Object.keys(p)) say(k, p[k], p[k].name, p[k].length);
// the text is another one than the build found
function other(t) { return eval("(function (x) { return x + " + t + "; })"); }
say(other(1)(1), other(2)(1), other("'a'")(1));
var flip = "1";
function changed() { return eval("(function changed() { return " + flip + "; })"); }
say(changed()()); flip = "2"; say(changed()(), changed());
// one character more
const texts = ["(function a() { return 1; })", "(function a() { return 1; }) ", "(function a() { return  1; })"];
for (const t of texts) { const f = eval(t); say(f(), f); }
