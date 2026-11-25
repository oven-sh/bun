import { test, vi } from 'bun:test';
globalThis.said = [];
test('the mock is laid again three jobs behind the call', async () => {
  vi.doMock('./r.mjs', async o => ({ v: 'one over ' + (await o()).v }));
  const call = import('./r.mjs');
  for (let i = 0; i < 3; i++) await 0;
  vi.doMock('./r.mjs', async o => ({ v: 'two over ' + (await o()).v }));
  console.log('SAID', (await call).v, '|', (await import('./r.mjs')).v, '|', globalThis.said.join());
}, 5000);
