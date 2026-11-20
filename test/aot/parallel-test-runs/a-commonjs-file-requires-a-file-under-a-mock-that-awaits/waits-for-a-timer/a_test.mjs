import { test, vi } from 'bun:test';
import { run } from './main.mjs';
vi.mock('./store.mjs', async () => { await new Promise(done => setTimeout(done, 5)); return { store: { size: -1 } }; });
test('a', async () => { console.log('SAID', run(), globalThis.bodies, (await import('./store.mjs')).store.size); });
