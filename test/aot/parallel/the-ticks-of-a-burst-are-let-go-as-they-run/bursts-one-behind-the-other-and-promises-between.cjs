const order = []; let digest = 0; const saw = x => { digest = (Math.imul(digest, 31) + x) | 0; };
let round = 0;
function burst() { const n = [5_000, 4_096, 4_097, 12_289, 1, 8_192, 20_000][round]; for (let i = 0; i < n; i++) { process.nextTick(saw, i); if (i % 1000 === 0) Promise.resolve(i).then(saw); } if (++round < 7) setImmediate(burst); else setImmediate(() => console.log(digest)); }
burst();
