// Exhaustive pairs of arrays over a small element alphabet; verdict of the loose and the strict Node relation.
const assert = require('assert');
const util = require('util');
const fs = require('fs');
const alphabet = (process.argv[3] || 'H,N,U,1,2').split(',');
const maxLen = Number(process.argv[4] || 4);
const build = word => {
  const a = [];
  a.length = word.length;
  word.forEach((k, i) => {
    switch (k) {
      case 'H': break;
      case 'N': a[i] = null; break;
      case 'U': a[i] = undefined; break;
      case '1': a[i] = 1; break;
      case '2': a[i] = 2; break;
      default: throw new Error(k);
    }
  });
  return a;
};
const words = len => { let out = [[]]; for (let i = 0; i < len; i++) out = out.flatMap(w => alphabet.map(k => [...w, k])); return out; };
const loose = (a, b) => { try { assert.notDeepEqual(a, b); return false; } catch (e) { if (e && e.code === 'ERR_ASSERTION') return true; throw e; } };
const result = {};
for (let len = 1; len <= maxLen; len++) {
  const ws = words(len);
  let L = '', S = '';
  for (const wa of ws) for (const wb of ws) {
    L += loose(build(wa), build(wb)) ? '1' : '0';
    S += util.isDeepStrictEqual(build(wa), build(wb)) ? '1' : '0';
  }
  result[len] = { words: ws.map(w => w.join(' ')), L, S };
}
fs.writeFileSync(process.argv[2], JSON.stringify(result));
