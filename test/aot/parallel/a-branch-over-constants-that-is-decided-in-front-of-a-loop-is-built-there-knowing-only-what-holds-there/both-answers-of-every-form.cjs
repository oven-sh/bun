'use strict';
process.env.TGM_SET = 'debug'; delete process.env.TGM_UNSET;
const D = JSON.parse('{"workers":"4","quiet":"","level":"","rows":[1,2,3]}');
function level() { return process.env.TGM_UNSET || 'info'; }
function forms(t) {
    let s = t & 1;
    for (let i = 0; i < 12; i++) s += (process.env.TGM_UNSET || 'info').length + (process.env.TGM_SET || 'info').length;
    for (let i = 0; i < 12; i++) s += (process.env.TGM_SET ? 4 : 1) + (process.env.TGM_UNSET ? 40 : 10);
    for (let i = 12; i > 0; i--) s += ((process.env.TGM_UNSET || 'dev') === 'dev' ? 100 : 200) + level().length;
    for (let i = 0; i < 12; i++) s += (D.workers ? 4 : 1) + (D.quiet ? 8 : 2) + (D.level || 'info').length + (D.rows || 'none').length;
    return s;
}
console.log(forms(0), forms(1));
