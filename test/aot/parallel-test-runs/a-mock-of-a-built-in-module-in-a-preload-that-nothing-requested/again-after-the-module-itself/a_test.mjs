import { test, vi } from 'bun:test';
test('a', async () => {
  vi.doMock('node:path', () => ({ basename: () => 'test', default: { basename: () => 'test default' } }));
  const { read } = await import('./lib.mjs');
  console.log('SAID', read('/x/y'));
  vi.doUnmock('node:path');
  console.log('SAID', read('/x/y'));
});
test('b', async () => { console.log('SAID b', (await import('./lib.mjs')).read('/x/y')); });
