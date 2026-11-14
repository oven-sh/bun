import { test, vi } from 'bun:test';
test('a', async () => { vi.doMock('./store.mjs', async () => { await 0; return { store: { size: -1 } }; }); const { run } = await import('./main.mjs'); console.log('SAID', run(), globalThis.bodies, (await import('./store.mjs')).store.size); });
