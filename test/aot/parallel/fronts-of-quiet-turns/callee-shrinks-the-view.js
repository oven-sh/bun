function scan(b) { let sum = 0; for (let i = 0; i < b.n; i++) { const word = b.words[i]; sum += word === undefined ? 1000 : word; if (word === 7) cut(b); } return sum; }
function cut(b) { b.buffer.resize(20); }
function make() { const buffer = new ArrayBuffer(40, { maxByteLength: 40 }); const words = new Int32Array(buffer); words.fill(1); words[3] = 7; return { n: 10, words, buffer }; }
let t = 0; for (let k = 0; k < 100; k++) t += scan(make()); console.log(t);
// STATISTIC: LoopReloadBlocksEmitted >= 1
// STATISTIC: ReloadingBackEdgesEmitted >= 1
