setTimeout(() => { try { console.log(t.v); } catch (e) { console.log(e.name); } try { console.log(g()); } catch (e) { console.log(e.name); } }, 0);
const t = require("./t.cjs");
const K = 3;
function g() { return K + t.v; }
