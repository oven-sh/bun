import { test } from 'bun:test';
globalThis.said = [];
test('two calls in front of the mock', async () => {
  const first = import('./a1.mjs').then(m => m.v);
  const second = import('./a1.mjs').then(m => m.v);
  console.log('SAID 1', await first, await second);
  await new Promise(d => setTimeout(d, 60));
  console.log('SAID 2', (await import('./a1.mjs')).v, globalThis.said.join());
  console.log('SAID zz end');
}, 5000);
