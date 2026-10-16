const { once } = require('node:events');
const fs = require('node:fs');
const big = Buffer.alloc(1024 * 1024 + 1, 'a');
(async () => {
  process.stdout.write(big);
  process.stdout.end();
  try { await once(process.stdout, 'finish'); fs.writeSync(2, 'finished\n'); }
  catch (e) { fs.writeSync(2, 'caught ' + e.code + '\n'); }
})();
