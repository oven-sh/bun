'use strict';
delete process.env.TGM_UNSET;
function early(k) { let s = 0; for (let i = 0; i < 12; i++) { if (i === k) break; s += (process.env.TGM_UNSET || 'info').length; } return s; }
function none() { let s = 0; for (let i = 0; i < 0; i++) s += (process.env.TGM_UNSET || 'info').length; return s; }
function nested(m) { let s = 0; for (let j = 0; j < m; j++) for (let i = 0; i < 12; i++) s += (process.env.TGM_UNSET || 'info').length + j; return s; }
function handled() { let s = 0; try { for (let i = 0; i < 12; i++) { s += (process.env.TGM_UNSET || 'info').length; if (i === 9) throw new Error('nine'); } } catch (e) { s += e.message.length; } return s; }
function some(k) { let s = 0; for (let i = 0; i < 12; i++) if (i % k) s += (process.env.TGM_UNSET || 'info').length; return s; }
console.log(early(0), early(1), early(11), early(99), none(), nested(0), nested(1), nested(3), handled(), some(1), some(2), some(5));
