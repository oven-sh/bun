import { test } from 'bun:test';
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
globalThis.said = [];
test('two calls in front of the mock', async () => {
  const first = import('./a1.mjs').then(m => m.v);
  const second = import('./a1.mjs').then(m => m.v);
  console.log('SAID 1', await first, await second);
  await spinEventLoop();
  console.log('SAID 2', (await import('./a1.mjs')).v, globalThis.said.join());
  console.log('SAID zz end');
}, 5000);
