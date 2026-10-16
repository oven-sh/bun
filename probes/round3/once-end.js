const big = Buffer.alloc(1024 * 1024 + 1, 'a');
let n = 0;
process.stdout.once('error', e => { n++; process.stderr.write('handled#' + n + ' ' + e.code + '\n'); });
process.stdout.write(big);
process.stdout.end();
