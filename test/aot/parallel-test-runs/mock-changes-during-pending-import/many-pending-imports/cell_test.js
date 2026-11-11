const { test, vi } = require('bun:test');
const calls = async n => {
  const start = performance.now();
  const all = [];
  for (let i = 0; i < n; i++) all.push(import('./m.mjs'));
  if (false) for (let i = 0; i < n; i++) require('./c.cjs');
  await Promise.all(all);
  return performance.now() - start;
};
test('calls of import() under way under a mock', async () => {
  vi.doMock('./m.mjs', () => ({ word: 'mock' }));
  await import('./m.mjs');
  await calls(2000);
  const small = Math.min(await calls(3000), await calls(3000), await calls(3000));
  const large = Math.min(await calls(48000), await calls(48000));
  console.log('SAID 1', large > small * 96 + 10 ? 'over' : 'linear');
  console.log('SAID zz end');
}, 120000);
