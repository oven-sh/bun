'use strict';
Error.stackTraceLimit = 20;
const names = e => { const all = String(e.stack).split('\n').slice(1).map(l => { const m = /^\s*at (?:async )?([^\s(]+) \(/.exec(l); return m ? m[1] : '<anonymous>'; }); const end = all.indexOf('outermost'); return all.slice(0, end + 1).join(' < '); };
let seen = '';
function cap() { seen = names(new Error('x')); }
const round = f => { for (let i = 0; i < 3; i++) { seen = ''; f(); if (i !== 1) console.log(seen); } };
function outermost() { const l = [1, 2].flatMap(function thrower(x) { if (x === 2) throw new RangeError('r'); return x; }); return l.length; }
for (let i = 0; i < 3; i++) try { outermost(); } catch (e) { console.log(e.name, names(e)); }
