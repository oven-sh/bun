'use strict';
const said = [];
const attempt = (f) => { try { return f(); } catch (error) { return error.constructor.name; } };
const q = +(process.argv[2] ?? 3);
const b = Buffer.alloc(100, 7), u = new Uint8Array(100).fill(5);
const hidden = (f) => ({ f })[JSON.parse('"f"')];
const cut = p => { let s = ''; for (let i = 0; i < 100; i++) s = p.slice(1, 3).constructor.name + p.subarray(1, 3).constructor.name + p.toString().length + p.indexOf(q) + p.includes(7) + p.lastIndexOf(5) + typeof p.toJSON + p.toLocaleString().length; return s; };
said.push(cut(b), cut(u));
console.log(said.join(' | '));
