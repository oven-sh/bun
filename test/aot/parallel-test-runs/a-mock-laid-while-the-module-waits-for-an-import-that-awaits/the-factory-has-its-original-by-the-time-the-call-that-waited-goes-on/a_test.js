import { test } from 'bun:test';
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
globalThis.said = [];
test('a file under way is mocked by what it imports', async () => {
  const one = await import('./a1.mjs').then(m => m.v, e => e.name);
  console.log('SAID 1', one);
  console.log('SAID 2', globalThis.said.join(' '));
  await spinEventLoop();
  console.log('SAID 3', globalThis.said.join(' '));
  console.log('SAID zz end');
}, 4000);
