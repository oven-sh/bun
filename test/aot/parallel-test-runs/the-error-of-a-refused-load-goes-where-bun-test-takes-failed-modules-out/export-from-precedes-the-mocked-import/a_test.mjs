import { test, vi } from 'bun:test';
const get = () => import('./root.mjs').then(() => 'loaded', e => e);
test('the load is retried', async () => {
  const first = await get();
  const again = await get();
  vi.doMock('./far.mjs', () => ({ far: 'mock' }));
  const behind = await get();
  const far = await import('./far.mjs').then(m => m.far, e => e.name);
  console.log('SAID', first?.name, first === again, again === behind, behind?.name, far);
}, 5000);
