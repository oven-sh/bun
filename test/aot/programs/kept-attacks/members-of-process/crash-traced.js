// Prototype chains are changed at random while their heirs are read, asked and stored to by name, at sites that see many structures.
let seed = 7919; const pick = n => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return (seed >>> 8) % n; };
const NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'id', 'key', 'value', 'kind', 'next', 'size', 'then', 'toJSON', 'method', 'state', 'name2', 'length2'];
const read = [o => o.a, o => o.b, o => o.c, o => o.d, o => o.e, o => o.f, o => o.g, o => o.h, o => o.id, o => o.key, o => o.value, o => o.kind, o => o.next, o => o.size, o => o.then, o => o.toJSON, o => o.method, o => o.state, o => o.name2, o => o.length2];
const readAgain = [o => o.a, o => o.b, o => o.c, o => o.d, o => o.e, o => o.f, o => o.g, o => o.h, o => o.id, o => o.key, o => o.value, o => o.kind, o => o.next, o => o.size, o => o.then, o => o.toJSON, o => o.method, o => o.state, o => o.name2, o => o.length2];
const has = [o => "a" in o, o => "b" in o, o => "c" in o, o => "d" in o, o => "e" in o, o => "f" in o, o => "g" in o, o => "h" in o, o => "id" in o, o => "key" in o, o => "value" in o, o => "kind" in o, o => "next" in o, o => "size" in o, o => "then" in o, o => "toJSON" in o, o => "method" in o, o => "state" in o, o => "name2" in o, o => "length2" in o];
const write = [(o, v) => { o.a = v; }, (o, v) => { o.b = v; }, (o, v) => { o.c = v; }, (o, v) => { o.d = v; }, (o, v) => { o.e = v; }, (o, v) => { o.f = v; }, (o, v) => { o.g = v; }, (o, v) => { o.h = v; }, (o, v) => { o.id = v; }, (o, v) => { o.key = v; }, (o, v) => { o.value = v; }, (o, v) => { o.kind = v; }, (o, v) => { o.next = v; }, (o, v) => { o.size = v; }, (o, v) => { o.then = v; }, (o, v) => { o.toJSON = v; }, (o, v) => { o.method = v; }, (o, v) => { o.state = v; }, (o, v) => { o.name2 = v; }, (o, v) => { o.length2 = v; }];
const remove = [o => delete o.a, o => delete o.b, o => delete o.c, o => delete o.d, o => delete o.e, o => delete o.f, o => delete o.g, o => delete o.h, o => delete o.id, o => delete o.key, o => delete o.value, o => delete o.kind, o => delete o.next, o => delete o.size, o => delete o.then, o => delete o.toJSON, o => delete o.method, o => delete o.state, o => delete o.name2, o => delete o.length2];
let log = 0, digest = 0, serial = 0, tracing = false;
const mix = n => { digest = (Math.imul(digest, 31) + n) | 0; };
const show = v => typeof v === "number" ? v : typeof v === "string" ? v.length + 1000 : v === undefined ? -1 : typeof v === "function" ? -2 : -3;
const attempt = f => { try { return f(); } catch (error) { return error instanceof TypeError ? "T" : "E"; } };
let protos = [];
const freshProto = () => { const p = pick(2) ? {} : JSON.parse('{"z0":0,"z1":1,"z2":2}'); p.tag = ++serial; return p; };
for (let i = 0; i < 10; i++) protos.push(freshProto());
const chainHas = (p, q) => { for (; p; p = Object.getPrototypeOf(p)) if (p === q) return true; return false; };
for (let i = 1; i < 10; i++) if (pick(3)) Object.setPrototypeOf(protos[i], protos[pick(i)]);
let heirs = [];
const freshHeir = () => { const o = Object.create(protos[pick(protos.length)]); const n = pick(4); for (let i = 0; i < n; i++) o["own" + pick(30)] = i; return o; };
for (let i = 0; i < 60; i++) heirs.push(freshHeir());
function fill(o, v) { o.a = v; o.b = v + 1; o.c = v + 2; }
function Shared(v) { this.d = v; this.e = v; this.state = v; }
const makers = [function (v) { Shared.call(this, v); this.id = v; }, function (v) { Shared.call(this, v); this.key = v; this.size = 1; }, function (v) { this.kind = 0; Shared.call(this, v); }];
function look(count) {
  for (let i = 0; i < count; i++) {
    const o = heirs[pick(heirs.length)];
    for (let k = 0; k < NAMES.length; k++) { mix(show(attempt(() => read[k](o)))); mix(has[k](o) ? 1 : 0); }
    const k = pick(NAMES.length), key = NAMES[pick(NAMES.length)];
    mix(show(attempt(() => readAgain[k](o))));
    mix(show(attempt(() => o[key]))); mix(key in o ? 1 : 0); mix(Object.prototype.hasOwnProperty.call(o, key) ? 1 : 0);
  }
}
function deed() {
  const pi = pick(protos.length), p = protos[pi], k = pick(NAMES.length), name = NAMES[k];
  const what = pick(17);
  if (tracing) console.log("deed", what, "proto", pi, "tag", p.tag, name);
  switch (what) {
  case 0: attempt(() => write[k](p, ++serial)); break;
  case 1: attempt(() => Reflect.set(p, name, ++serial)); break;
  case 2: attempt(() => remove[k](p)); break;
  case 3: attempt(() => Reflect.deleteProperty(p, name)); break;
  case 4: { const tag = ++serial; attempt(() => Object.defineProperty(p, name, { get() { return tag; }, set(v) { log += tag; }, configurable: true, enumerable: true })); break; }
  case 5: attempt(() => Object.defineProperty(p, name, { value: ++serial, writable: false, configurable: true, enumerable: true })); break;
  case 6: attempt(() => Object.defineProperty(p, name, { value: ++serial, writable: true, configurable: true, enumerable: pick(2) === 0 })); break;
  case 7: { const q = pick(5) ? protos[pick(protos.length)] : null; if (!q || !chainHas(q, p)) attempt(() => Object.setPrototypeOf(p, q)); break; }
  case 8: { const n = 20 + pick(160); for (let i = 0; i < n; i++) { attempt(() => Reflect.set(p, "passing" + i, i)); if (i) attempt(() => Reflect.deleteProperty(p, "passing" + (i - 1))); } break; }
  case 9: { const at = pick(protos.length); if (pick(3) === 0) attempt(() => [Object.freeze, Object.seal, Object.preventExtensions][pick(3)](protos[at])); protos[at] = freshProto(); if (pick(2)) Object.setPrototypeOf(protos[at], protos[(at + 1 + pick(protos.length - 1)) % protos.length]); break; }
  case 10: for (let i = 0; i < 6; i++) heirs[pick(heirs.length)] = freshHeir(); break;
  case 11: { const o = heirs[pick(heirs.length)]; mix(show(attempt(() => write[k](o, ++serial)))); mix(Object.hasOwn(o, name) ? 1 : 0); break; }
  case 12: { for (let i = 0; i < 8; i++) { const o = freshHeir(); mix(show(attempt(() => write[k](o, i)))); mix(Object.hasOwn(o, name) ? 1 : 0); mix(show(attempt(() => read[k](o)))); } break; }
  case 13: { const o = heirs[pick(heirs.length)]; attempt(() => remove[k](o)); break; }
  case 14: { for (let i = 0; i < 6; i++) { const o = freshHeir(); mix(show(attempt(() => fill(o, i)))); mix(Object.keys(o).length); mix(show(attempt(() => o.b))); } break; }
  case 15: { for (let i = 0; i < 6; i++) { const o = freshHeir(); mix(show(attempt(() => { o[name] = i; }))); mix(Object.hasOwn(o, name) ? 1 : 0); } break; }
  case 16: { for (let i = 0; i < 4; i++) { const C = makers[pick(makers.length)]; C.prototype = protos[pick(protos.length)]; const o = attempt(() => new C(i)); mix(typeof o === "object" ? Object.keys(o).length : -5); } break; }
  }
}
look(200);
for (let step = 1; step <= 20000; step++) {
  tracing = step >= 1000;
  deed();
  look(3);
  if (step % 250 === 0) console.log(step, digest, log, serial);
}
look(200);
console.log(digest, log, serial);
