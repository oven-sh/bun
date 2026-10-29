import sloppyStoreAlpha from "./sloppy.cjs";
const lines = [];
function say(label, value) {
  lines.push(label + ": " + (JSON.stringify(value) ?? String(value)));
}

function storeAlpha(o, v) { o.alpha = v; }
function storeBeta(o, v) { o.beta = v; }
function storeGamma(o, v) { o.gamma = v; }
function storeThree(o, v) { o.alpha = v; o.beta = v + 1; o.gamma = v + 2; }
function attempt(store, o, v) {
  try {
    store(o, v);
    return "stored";
  } catch (error) {
    return error.constructor.name;
  }
}
function look(o) {
  return Object.getOwnPropertyNames(o).map(name => {
    const d = Object.getOwnPropertyDescriptor(o, name);
    return name + "=" + ("value" in d ? JSON.stringify(d.value) : "accessor") + (d.writable === false ? "!w" : "") + (d.enumerable ? "" : "!e") + (d.configurable ? "" : "!c");
  }).join(",");
}

// Replacing and adding at every place of the object, in the object and outside it.
{
  for (let before = 0; before < 14; before++) {
    const o = {};
    for (let i = 0; i < before; i++) o["pad" + i] = i;
    for (let round = 0; round < 3; round++) storeThree(o, before * 10 + round);
    say("place " + before, look(o));
  }
  const wide = {};
  for (let i = 0; i < 80; i++) wide["w" + i] = i;
  for (let round = 0; round < 3; round++) storeThree(wide, round);
  say("wide", [wide.alpha, wide.beta, wide.gamma, Object.keys(wide).length]);
}

// A setter or a read-only property appears on the prototype after stores that add the property were seen.
{
  const parent = {};
  const make = () => Object.create(parent);
  for (let round = 0; round < 4; round++) {
    const o = make();
    storeAlpha(o, round);
    say("adds", look(o));
  }
  const seen = [];
  Object.defineProperty(parent, "alpha", { set(v) { seen.push(v); }, get() { return "from getter"; }, configurable: true });
  for (let round = 0; round < 3; round++) {
    const o = make();
    storeAlpha(o, round);
    say("setter", [look(o), o.alpha, seen.length]);
  }
  Object.defineProperty(parent, "alpha", { value: "fixed", writable: false, configurable: true });
  for (let round = 0; round < 3; round++) {
    const o = make();
    say("read-only above", [attempt(storeAlpha, o, round), attempt(sloppyStoreAlpha, o, round), look(o), o.alpha]);
  }
  delete parent.alpha;
  for (let round = 0; round < 3; round++) {
    const o = make();
    storeAlpha(o, round);
    say("adds again", look(o));
  }
  const grandparent = { set beta(v) { seen.push("beta " + v); } };
  for (let round = 0; round < 3; round++) {
    const o = make();
    storeBeta(o, round);
    say("beta adds", look(o));
  }
  Object.setPrototypeOf(parent, grandparent);
  for (let round = 0; round < 3; round++) {
    const o = make();
    storeBeta(o, round);
    say("beta goes to the setter", [look(o), seen.length]);
  }
}

// The property changes under the store.
{
  const o = { alpha: 1, beta: 2 };
  for (let round = 0; round < 3; round++) storeAlpha(o, round);
  say("plain", look(o));
  Object.defineProperty(o, "alpha", { writable: false });
  say("read-only", [attempt(storeAlpha, o, 9), attempt(sloppyStoreAlpha, o, 9), look(o)]);
  Object.defineProperty(o, "alpha", { writable: true, enumerable: false });
  say("hidden", [attempt(storeAlpha, o, 10), look(o)]);
  let got;
  Object.defineProperty(o, "alpha", { set(v) { got = v; }, configurable: true });
  say("own setter", [attempt(storeAlpha, o, 11), got, look(o)]);
  Object.defineProperty(o, "alpha", { get() { return 1; }, set: undefined });
  say("getter only", [attempt(storeAlpha, o, 12), attempt(sloppyStoreAlpha, o, 12), look(o)]);
  delete o.alpha;
  say("added anew", [attempt(storeAlpha, o, 13), look(o)]);
  for (const close of [Object.preventExtensions, Object.seal, Object.freeze]) {
    const p = { alpha: 1 };
    storeAlpha(p, 2);
    close(p);
    say(close.name, [attempt(storeAlpha, p, 3), attempt(storeBeta, p, 4), attempt(sloppyStoreAlpha, p, 5), look(p)]);
  }
}

// Definitions do not ask the prototype chain, stores do.
{
  const log = [];
  class Base {
    set alpha(v) { log.push("setter " + v); }
    get alpha() { return "getter"; }
  }
  class WithField extends Base { alpha = 1; }
  class WithStore extends Base { constructor() { super(); this.alpha = 2; } }
  for (let round = 0; round < 3; round++) say("field or store", [look(new WithField()), look(new WithStore()), log.length]);
  const literal = v => ({ alpha: v, beta: v, alpha: v + 1 });
  for (let round = 0; round < 3; round++) say("literal", look(literal(round)));
  const spreadThenDefine = (from, v) => ({ ...from, alpha: v });
  const hidden = Object.defineProperty({}, "alpha", { value: 0, enumerable: true, writable: false, configurable: true });
  for (let round = 0; round < 3; round++) say("defined over", [look(spreadThenDefine(hidden, round)), look(spreadThenDefine({ beta: 1 }, round))]);
}

// Dictionaries.
{
  const d = {};
  for (let i = 0; i < 300; i++) d["k" + i] = i;
  for (let round = 0; round < 3; round++) storeThree(d, round);
  say("dictionary", [d.alpha, d.beta, d.gamma, Object.keys(d).length]);
  for (let i = 0; i < 300; i += 3) delete d["k" + i];
  delete d.beta;
  for (let round = 0; round < 3; round++) storeThree(d, 10 + round);
  say("dictionary with holes", [d.alpha, d.beta, d.gamma, Object.keys(d).length, Object.keys(d).slice(-3)]);
}

// Receivers that are not plain objects.
{
  function named() {}
  const trapped = [];
  const proxy = new Proxy({}, { set(target, key, v) { trapped.push(key + "=" + v); return key !== "beta"; } });
  const receivers = [named, [1, 2], new String("s"), new Map(), /x/, new Date(0), proxy, () => 1, new Uint8Array(2), new Error("e"), Object.create(null), "text", 12, true, 10n, Symbol("s"), undefined, null];
  for (let round = 0; round < 3; round++) {
    say("receivers", receivers.map(o => attempt(storeAlpha, o, round) + "/" + attempt(storeBeta, o, round) + "/" + attempt(sloppyStoreAlpha, o, round)));
  }
  say("kept", receivers.slice(0, 11).map(o => (o === proxy ? trapped.length : [o.alpha, o.beta])));
}

// Stores and reads interleaved on shapes that come and go.
{
  let total = 0;
  for (let i = 0; i < 20000; i++) {
    const o = {};
    o["unique" + i] = i;
    storeAlpha(o, i);
    if (i & 1) storeBeta(o, 1);
    storeAlpha(o, o.alpha + 1);
    storeGamma(o, (o.beta ?? 0) + o.alpha);
    total += o.gamma;
    if (i % 5000 === 0) gc();
  }
  say("short-lived shapes", total);
}

// Seventy names stored one after another: the storage out of line is made, then doubled four times. Fresh objects of several kinds take the same road again and again.
function growByStores(o, seed) {
  o.grown0 = seed + 0;
  o.grown1 = seed + 1;
  o.grown2 = seed + 2;
  o.grown3 = seed + 3;
  o.grown4 = seed + 4;
  o.grown5 = seed + 5;
  o.grown6 = seed + 6;
  o.grown7 = seed + 7;
  o.grown8 = seed + 8;
  o.grown9 = seed + 9;
  o.grown10 = seed + 10;
  o.grown11 = seed + 11;
  o.grown12 = seed + 12;
  o.grown13 = seed + 13;
  o.grown14 = seed + 14;
  o.grown15 = seed + 15;
  o.grown16 = seed + 16;
  o.grown17 = seed + 17;
  o.grown18 = seed + 18;
  o.grown19 = seed + 19;
  o.grown20 = seed + 20;
  o.grown21 = seed + 21;
  o.grown22 = seed + 22;
  o.grown23 = seed + 23;
  o.grown24 = seed + 24;
  o.grown25 = seed + 25;
  o.grown26 = seed + 26;
  o.grown27 = seed + 27;
  o.grown28 = seed + 28;
  o.grown29 = seed + 29;
  o.grown30 = seed + 30;
  o.grown31 = seed + 31;
  o.grown32 = seed + 32;
  o.grown33 = seed + 33;
  o.grown34 = seed + 34;
  o.grown35 = seed + 35;
  o.grown36 = seed + 36;
  o.grown37 = seed + 37;
  o.grown38 = seed + 38;
  o.grown39 = seed + 39;
  o.grown40 = seed + 40;
  o.grown41 = seed + 41;
  o.grown42 = seed + 42;
  o.grown43 = seed + 43;
  o.grown44 = seed + 44;
  o.grown45 = seed + 45;
  o.grown46 = seed + 46;
  o.grown47 = seed + 47;
  o.grown48 = seed + 48;
  o.grown49 = seed + 49;
  o.grown50 = seed + 50;
  o.grown51 = seed + 51;
  o.grown52 = seed + 52;
  o.grown53 = seed + 53;
  o.grown54 = seed + 54;
  o.grown55 = seed + 55;
  o.grown56 = seed + 56;
  o.grown57 = seed + 57;
  o.grown58 = seed + 58;
  o.grown59 = seed + 59;
  o.grown60 = seed + 60;
  o.grown61 = seed + 61;
  o.grown62 = seed + 62;
  o.grown63 = seed + 63;
  o.grown64 = seed + 64;
  o.grown65 = seed + 65;
  o.grown66 = seed + 66;
  o.grown67 = seed + 67;
  o.grown68 = seed + 68;
  o.grown69 = seed + 69;
  return o;
}
{
  const kinds = [() => ({}), () => Object.create(null), () => ({ first: 1, second: 2 }), () => { const o = {}; o[0] = "indexed"; o[7] = "too"; return o; }, () => [1, 2, 3], () => function named() {}, () => new (class Plain {})(), () => Object.create({ grown5: "shadowed", set grown9(v) { this.caught = v; } })];
  for (let round = 0; round < 6; round++) {
    const digests = kinds.map((make, kind) => {
      const o = growByStores(make(), round * 1000 + kind * 100);
      let sum = 0;
      for (const key of Object.keys(o)) sum = (sum * 31 + key.length * 7 + (typeof o[key] === "number" ? o[key] : 1)) % 1000003;
      return Object.keys(o).length + ":" + sum + ":" + o.grown0 + ":" + o.grown3 + ":" + o.grown4 + ":" + o.grown11 + ":" + o.grown12 + ":" + o.grown35 + ":" + o.grown36 + ":" + o.grown69 + ":" + o.caught;
    });
    if (round % 5 === 0) gc();
    say("grown " + round, digests);
  }
}

// Stores that no cache can take, made often: the length of an array, lastIndex of a RegExp, a Proxy, a dictionary that keeps changing.
{
  const list = [1, 2, 3, 4, 5, 6, 7, 8];
  const re = /a/g;
  let seen = 0;
  const proxy = new Proxy({}, { set(target, key, value) { seen += value; return true; } });
  const changing = {};
  for (let i = 0; i < 200; i++) changing["k" + i] = i;
  for (let i = 0; i < 150; i++) delete changing["k" + i];
  function shorten(a, n) { a.length = n; }
  function rewind(r, n) { r.lastIndex = n; }
  function tell(p, n) { p.told = n; }
  for (let i = 0; i < 300; i++) {
    shorten(list, 8 - (i % 8));
    rewind(re, i % 5);
    tell(proxy, i);
    tell(changing, i);
    if (i % 50 === 49) delete changing.told;
    if (i % 8 === 7) list.push(i, i, i, i, i, i, i);
  }
  say("never cached", [list.length, list.join(), re.lastIndex, seen, changing.told, Object.keys(changing).length]);
}

// A class with a getter of another name on its prototype: its constructor's stores and its fields' definitions are seen many times; then the chain changes under one of the names.
{
  const seen = [];
  class Base { get other() { return "other"; } }
  class Made extends Base {
    defined = "field";
    alsoDefined;
    constructor(v) { super(); this.stored = v; this.storedToo = v + 1; }
    get unrelated() { return this.stored; }
  }
  const show = o => [Object.keys(o).join(), o.defined, o.stored, o.storedToo, o.unrelated, o.other];
  for (let i = 0; i < 6; i++) say("made " + i, show(new Made(i)));
  Object.defineProperty(Base.prototype, "stored", { set(v) { seen.push("stored " + v); }, get() { return "by getter"; }, configurable: true });
  for (let i = 0; i < 3; i++) say("a setter far up " + i, [show(new Made(i)), seen.length]);
  Object.defineProperty(Made.prototype, "defined", { set(v) { seen.push("defined " + v); }, configurable: true });
  for (let i = 0; i < 3; i++) say("a definition passes a setter by " + i, [show(new Made(i)), seen.length]);
  delete Base.prototype.stored;
  for (let i = 0; i < 3; i++) say("the setter is gone " + i, [show(new Made(i)), seen.length]);
  Object.defineProperty(Made.prototype, "storedToo", { value: "fixed", writable: false, configurable: true });
  for (let i = 0; i < 3; i++) {
    let outcome;
    try { outcome = show(new Made(i)); } catch (error) { outcome = error.constructor.name; }
    say("read-only near " + i, outcome);
  }
  delete Made.prototype.storedToo;
  Object.setPrototypeOf(Made.prototype, { set stored(v) { seen.push("swapped " + v); } });
  for (let i = 0; i < 3; i++) {
    const o = new Made(i);
    say("another parent " + i, [Object.keys(o).join(), o.stored, o.storedToo, seen.length]);
  }
}

console.log(lines.join("\n"));
