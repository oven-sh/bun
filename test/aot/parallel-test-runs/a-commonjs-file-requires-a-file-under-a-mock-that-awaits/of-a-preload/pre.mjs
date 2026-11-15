import { mock } from 'bun:test';
mock.module('./store.mjs', async () => { await 0; return { store: { size: -1 } }; });
