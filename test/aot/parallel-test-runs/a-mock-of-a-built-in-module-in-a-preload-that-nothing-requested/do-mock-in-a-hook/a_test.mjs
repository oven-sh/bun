import { test, vi, beforeAll } from 'bun:test';
beforeAll(() => { vi.doMock('node:path', () => ({ basename: () => 'test' })); });
test('a', async () => { console.log('SAID a', (await import('./index.mjs')).d('/x/y')); });
