function fail(i) { const detail = { v: i }; const error = new Error("no"); error.detail = detail; throw error; }
function plain(i) { throw { v: i, more: [i] }; }
function through(i) { try { plain(i); } finally { i++; } }
let out = "";
try { fail(1); } catch (e) { out += e.detail.v; }
try { through(2); } catch (e) { out += e.v + e.more.length; }
console.log(out);
