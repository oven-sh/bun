// Fields that loops read and write by position are filled with views, arrays, strings and other objects, and are replaced, deleted, frozen or detached inside the loop.
function makeImage(n) { var image = {}; image.data = new Uint8Array(n); return image; }
function Screen(n) { this.data = []; this.mark = 0; this.fill(n); }
Screen.prototype.fill = function (n) { this.data = new Int16Array(n); };
class Sheet { constructor(n) { this.data = null; this.data = new Float32Array(n); } }

function hash(buffer, event, at) { var sum = 0; for (var i = 0; i < buffer.data.length; i++) { if (i === at) event(buffer); sum ^= (i * buffer.data[i]) | 0; } return sum; }
function store(buffer, event, at) { for (var i = 0; i < 12; i++) { if (i === at) event(buffer); buffer.data[i] = i * 37.5; } return show(buffer.data); }
function copy(buffer, event, at) { var data = buffer.data, out = []; for (var i = 0; i < 12; ++i) { if (i === at) event(buffer); data[i++] = i * 20; out.push(data[i]); } return out.join() + " " + show(data); }
function toggle(buffer, event, at) { for (var i = 0; i < 8; i++) { if (i === at) event(buffer); buffer.data[i] ^= 85; ++buffer.data[i]; } return show(buffer.data); }
function show(v) { return v == null ? String(v) : typeof v === "string" ? v : v.constructor.name + ":" + Array.prototype.join.call(v); }

var effects = 0;
const makers = {
  image: () => makeImage(9),
  screen: () => new Screen(9),
  sheet: () => new Sheet(9),
  array: () => { var image = makeImage(1); image.data = [1, 2.5, , "4"]; return image; },
  text: () => { var image = makeImage(1); image.data = "0123456789"; return image; },
  like: () => { var image = makeImage(1); image.data = { length: 5, 0: 3, 1: 300 }; return image; },
  nothing: () => { var image = makeImage(1); image.data = null; return image; },
  getter: () => ({ get data() { effects++; return [7, 8, 9]; } }),
  proxy: () => new Proxy(makeImage(5), { get(target, key) { effects++; return target[key]; } }),
  resizable: () => { var image = makeImage(1); image.data = new Uint8Array(new ArrayBuffer(16, { maxByteLength: 64 })); return image; },
  frozen: () => Object.freeze(makeImage(6)),
};
const events = {
  none: () => {},
  replaced: h => { h.data = [1.5, "x", 3]; },
  shorter: h => { h.data = new Uint8Array(2); },
  deleted: h => { delete h.data; },
  accessor: h => { Object.defineProperty(h, "data", { configurable: true, get() { effects++; return new Int8Array([1, 2, 3, 4]); } }); },
  detached: h => { if (ArrayBuffer.isView(h.data)) h.data.buffer.transfer(); },
  resized: h => { if (ArrayBuffer.isView(h.data) && h.data.buffer.resizable) h.data.buffer.resize(3); },
  frozen: h => { Object.freeze(h); },
};
for (const [made, make] of Object.entries(makers)) {
  for (const [happens, event] of Object.entries(events)) {
    const line = [];
    for (const use of [hash, store, copy, toggle]) {
      try { line.push(use(make(), event, 3)); } catch (error) { line.push(error.constructor.name); }
    }
    console.log(made, happens, effects, line.join(" | "));
  }
}
