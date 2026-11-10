import { test } from 'bun:test';
globalThis.said = [];
const limit = (p, ms = 1500) => Promise.race([p, new Promise(d => setTimeout(d, ms, 'HANGS'))]);
test('a file under way is mocked by what it imports', async () => {
  const one = await limit(import('./a1.mjs').then(m => m.v, e => e.name));
  console.log('SAID 1', one);
  console.log('SAID 2', globalThis.said.join(' '));
  await new Promise(d => setTimeout(d, 60));
  console.log('SAID 3', globalThis.said.join(' '));
  console.log('SAID zz end');
}, 4000);
