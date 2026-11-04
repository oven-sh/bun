const o = Object.preventExtensions({ 0: 1, x: 1 });
function put(h, i, v) { try { h[i] = v; return "stored"; } catch (e) { return e.constructor.name; } }
console.log(put(o, [].length, "text"), put(o, 1, "text"), typeof o[0], Object.keys(o).join());
