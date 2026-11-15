import { test, vi, mock } from 'bun:test';
const show = (n, o) => { let t, v; try { t = typeof o.set; } catch (e) { t = '!' + e.message.slice(0, 24); } try { v = o.val; } catch (e) { v = '!' + e.message.slice(0, 24); } console.log('SAID', n, t, v); };
test('b', async () => {
  vi.doMock('./e.mjs', () => ({ val: 'test' }));
  mock.module('./f.mjs', () => ({ f: 2 }));
  const x = await import('./e.mjs');
  show('b', x);
  if (globalThis.held) show('held', globalThis.held);
});
