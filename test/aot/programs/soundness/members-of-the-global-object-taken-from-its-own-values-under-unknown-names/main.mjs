// Members of a built-in object that nothing names: the object goes to a timer as an argument and comes back as a value nobody knows; each member is taken out of its own values under a name put together at run time, and used.
const never = process.argv.length > 99;
const glue = (...parts) => parts.join(never ? "x" : "");
setTimeout(async u => {
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('T', 'ransformStream')]?.value; r = f === undefined ? "absent" : String(typeof new f().readable); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.TransformStream', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('R', 'eadableStream')]?.value; r = f === undefined ? "absent" : String(typeof new f({ start(c) { c.close(); } }).getReader); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.ReadableStream', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('W', 'ritableStream')]?.value; r = f === undefined ? "absent" : String(typeof new f().getWriter); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.WritableStream', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('C', 'ompressionStream')]?.value; r = f === undefined ? "absent" : String(typeof new f('gzip').readable); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.CompressionStream', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('T', 'extDecoderStream')]?.value; r = f === undefined ? "absent" : String(typeof new f().readable); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.TextDecoderStream', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('T', 'extEncoderStream')]?.value; r = f === undefined ? "absent" : String(typeof new f().readable); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.TextEncoderStream', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('B', 'yteLengthQueuingStrategy')]?.value; r = f === undefined ? "absent" : String(new f({ highWaterMark: 2 }).highWaterMark); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.ByteLengthQueuingStrategy', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('C', 'ountQueuingStrategy')]?.value; r = f === undefined ? "absent" : String(new f({ highWaterMark: 2 }).size()); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.CountQueuingStrategy', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('W', 'ebSocket')]?.value; r = f === undefined ? "absent" : String(typeof f.OPEN); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.WebSocket', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('B', 'roadcastChannel')]?.value; r = f === undefined ? "absent" : String((() => { const b = new f('x'); b.close(); return b.name; })()); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.BroadcastChannel', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('M', 'essageChannel')]?.value; r = f === undefined ? "absent" : String(typeof new f().port1); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.MessageChannel', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('F', 'ormData')]?.value; r = f === undefined ? "absent" : String((() => { const d = new f(); d.append('a', 'b'); return d.get('a'); })()); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.FormData', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('I', 'ntl')]?.value; r = f === undefined ? "absent" : String(new f.NumberFormat('en').format(1.5)); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.Intl', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('W', 'ebAssembly')]?.value; r = f === undefined ? "absent" : String(f.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.WebAssembly', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('A', 'tomics')]?.value; r = f === undefined ? "absent" : String(f.add(new Int32Array(new SharedArrayBuffer(4)), 0, 2)); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.Atomics', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('F', 'inalizationRegistry')]?.value; r = f === undefined ? "absent" : String(typeof new f(() => {}).register); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.FinalizationRegistry', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('W', 'eakRef')]?.value; r = f === undefined ? "absent" : String(typeof new f({}).deref()); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.WeakRef', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('B', 'igInt64Array')]?.value; r = f === undefined ? "absent" : String(new f(1).length); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.BigInt64Array', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('F', 'loat16Array')]?.value; r = f === undefined ? "absent" : String(new f(1).length); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.Float16Array', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('D', 'ataView')]?.value; r = f === undefined ? "absent" : String(new f(new ArrayBuffer(2)).byteLength); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.DataView', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('P', 'roxy')]?.value; r = f === undefined ? "absent" : String(new f({ a: 1 }, {}).a); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.Proxy', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('R', 'eflect')]?.value; r = f === undefined ? "absent" : String(f.ownKeys({ a: 1 }).length); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.Reflect', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('S', 'ymbol')]?.value; r = f === undefined ? "absent" : String(typeof f('s')); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.Symbol', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('R', 'egExp')]?.value; r = f === undefined ? "absent" : String(new f('a+').test('aa')); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.RegExp', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('D', 'ate')]?.value; r = f === undefined ? "absent" : String(new f(0).getTime()); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.Date', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('T', 'emporal')]?.value; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.Temporal', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('n', 'avigator')]?.value; r = f === undefined ? "absent" : String(typeof f.userAgent); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.navigator', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('p', 'erformance')]?.value; r = f === undefined ? "absent" : String(typeof f.now()); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.performance', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('c', 'rypto')]?.value; r = f === undefined ? "absent" : String(f.randomUUID().length); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.crypto', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('s', 'tructuredClone')]?.value; r = f === undefined ? "absent" : String(f({ a: 1 }).a); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.structuredClone', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('f', 'etch')]?.value; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.fetch', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('H', 'TMLRewriter')]?.value; r = f === undefined ? "absent" : String(typeof new f().on); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.HTMLRewriter', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('W', 'orker')]?.value; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.Worker', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('E', 'ventSource')]?.value; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.EventSource', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('r', 'eportError')]?.value; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.reportError', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('a', 'lert')]?.value; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.alert', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('e', 'scape')]?.value; r = f === undefined ? "absent" : String(f('a b')); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.escape', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('b', 'toa')]?.value; r = f === undefined ? "absent" : String(f('a')); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.btoa', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('L', 'oader')]?.value; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.Loader', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('S', 'hadowRealm')]?.value; r = f === undefined ? "absent" : String(typeof f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.ShadowRealm', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('I', 'terator')]?.value; r = f === undefined ? "absent" : String(f.from([1]).toArray().length); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.Iterator', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('A', 'syncDisposableStack')]?.value; r = f === undefined ? "absent" : String(typeof new f().use); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.AsyncDisposableStack', r);
  }
  {
  let r; try { const f = Object.getOwnPropertyDescriptors(u)[glue('S', 'uppressedError')]?.value; r = f === undefined ? "absent" : String(new f(1, 2).suppressed); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 80); }
  console.log('globalThis.SuppressedError', r);
  }
}, 0, globalThis);
