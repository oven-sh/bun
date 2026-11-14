// for-of over literals: Latin-1, wide characters, pairs, lone surrogates, the empty text; characters kept, compared and sought.
const all = new Set('aeiou'); let kept;
function latin(turns) { let n = 0, s = ''; for (let k = 0; k < turns; k++) for (const c of 'the quick é fox') { if (all.has(c)) n++; if (c === 'q') s += c + k; kept = c; n += c.length + c.charCodeAt(0); } return n + s; }
function wide(turns) { let n = 0, s = ''; for (let k = 0; k < turns; k++) for (const c of 'aā中b') { n += c.codePointAt(0); s = c + s.slice(0, 5); } return n + s; }
function pairs(turns) { let n = 0, s = ''; for (let k = 0; k < turns; k++) for (const c of 'x😀y\ud83dz') { n += c.length * 100 + c.codePointAt(0); s = (s + c).slice(-7); } return n + s.length; }
function none(turns) { let n = 0; for (let k = 0; k < turns; k++) for (const c of '') n += c.length; return n; }
function out(turns) { let n = 0; for (let k = 0; k < turns; k++) for (const c of 'abcdef') { if (c === 'd') break; if (k === 3 && c === 'b') return n + c; n++; } return n; }
const t = 'module text'; function named(turns) { const l = []; for (let k = 0; k < turns; k++) for (const c of t) l.push(c); return l.join('') + l.length; }
for (const turns of [0, 1, 2, 30]) console.log(latin(turns), wide(turns), pairs(turns), none(turns), out(turns), named(turns), kept);
