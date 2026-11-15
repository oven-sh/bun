import { test, vi } from 'bun:test';
import { run } from './main.mjs';
vi.mock('./store.mjs', async original => { const it = await original(); return { store: { size: it.store.size - 1 } }; });
test('a', async () => { console.log('SAID', run(), globalThis.bodies, (await import('./store.mjs')).store.size); });
