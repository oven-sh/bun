'use strict';
const D = JSON.parse('{"mode":""}'), said = [];
function once() { let s = ''; for (let i = 0; i < 12; i++) s += (D.mode || 'dev')[0]; return s; }
function inTurn() { let s = ''; for (let i = 0; i < 12; i++) { s += (D.mode || 'dev')[0]; D.mode = i & 1 ? '' : 'prod'; } return s; }
function byEnv() { let s = ''; for (let i = 0; i < 12; i++) { process.env.TGM_TURN = i % 3 ? 'on' : ''; s += (process.env.TGM_TURN || 'off').length; } return s; }
said.push(once()); D.mode = 'prod'; said.push(once()); D.mode = ''; said.push(inTurn(), inTurn(), byEnv());
Object.defineProperty(D, 'mode', { get() { said.push('asked'); return ''; }, configurable: true }); said.push(once().length, said.filter(x => x === 'asked').length);
console.log(said.filter(x => x !== 'asked').join());
