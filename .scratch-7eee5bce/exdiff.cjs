const [refF, ...others] = process.argv.slice(2);
const ref = require(refF);
for (const f of others) {
  const o = require(f);
  for (const mode of ['L', 'S']) {
    let total = 0, diff = 0, wrongAccept = 0, wrongReject = 0; const ex = [];
    for (const len of Object.keys(ref)) {
      const ws = ref[len].words, n = ws.length;
      for (let i = 0; i < n * n; i++) {
        total++;
        if (ref[len][mode][i] !== o[len][mode][i]) {
          diff++;
          if (o[len][mode][i] === '1') wrongAccept++; else wrongReject++;
          if (ex.length < 4) ex.push(`[${ws[Math.floor(i / n)]}] vs [${ws[i % n]}] node=${ref[len][mode][i]} here=${o[len][mode][i]}`);
        }
      }
    }
    console.log(f, mode === 'L' ? 'loose ' : 'strict', `pairs=${total} differ=${diff} (accepts wrongly ${wrongAccept}, rejects wrongly ${wrongReject})`);
    for (const e of ex) console.log('    ', e);
  }
}
