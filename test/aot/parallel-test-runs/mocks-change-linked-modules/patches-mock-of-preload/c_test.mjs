import { test, vi } from 'bun:test'; import { read } from './service.mjs'; vi.mock('./db.mjs', async () => ({ queries: 70 })); test('c', () => { console.log('R c', read(), globalThis.keep()); });
