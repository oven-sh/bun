'use strict';
const list = JSON.parse('[' + Array.from({ length: 24 }, (_, i) => i + 0.5).join() + ']'), rows = JSON.parse('[null, 0, "1", 1, true, 1.5]');
function bySum(t) { const x = (t & 31) + 0.5; for (let i = 0; i < list.length; i++) if (list[i] === x) return i; return -1; }
function byDifference(t) { const x = (t & 31) - 0.5; for (let i = 0; i < list.length; i++) if (list[i] === x) return i; return -1; }
function byProduct(t) { const x = (t % 7) * 2 + 0.5; for (let i = 0; i < list.length; i++) if (list[i] === x) return i; return -1; }
function byText(t) { const x = (t & 31) + ".5"; for (let i = 0; i < list.length; i++) if (list[i] == x) return i; return -1; }
function inRows(t) { const x = (t & 1) + 0.5 * (t & 2); let c = 0; for (let i = 0; i < rows.length; i++) if (rows[i] === x) c++; return c; }
const said = []; for (let t = 0; t < 34; t++) said.push(bySum(t), byDifference(t), byProduct(t), byText(t), inRows(t)); console.log(said.join());
