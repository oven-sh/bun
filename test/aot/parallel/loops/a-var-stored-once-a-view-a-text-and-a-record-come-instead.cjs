// STATISTIC: ReceiversReadOffVariablesToldApartInFrontOfLoops >= 1
const q = Number(process.argv[2] ?? 3);
function pick(k) { return k === 0 ? new Float64Array([1.5, -0, q]) : k === 1 ? '12' + q : k === 2 ? JSON.parse('{"0":1,"1":"x","2":' + q + ',"length":3}') : new Uint8Array([250, 5, q]); }
var view = pick(q - 3), text = pick(q - 2), record = pick(q - 1), bytes = pick(q);
function a(t) { let s = t & 1; for (let i = 0; i < view.length; i++) s = s + view[i]; return s; }
function b(t) { let s = t & 1; for (let i = 0; i < text.length; i++) s = s + text[i]; return s; }
function c(t) { let s = t & 1; for (let i = 0; i < record.length; i++) s = s + record[i]; return s; }
function d(t) { let s = t & 1; for (let i = 0; i < bytes.length; i++) s = s + bytes[i]; return s; }
let last; for (let t = 0; t < 40; t++) last = [a(t), b(t), c(t), d(t)].join(); console.log(last);
