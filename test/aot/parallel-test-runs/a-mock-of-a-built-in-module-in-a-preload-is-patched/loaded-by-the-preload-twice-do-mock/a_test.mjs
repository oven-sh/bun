import { test, vi, mock } from 'bun:test';
import { read } from './lib.mjs';
test('a', async () => {
  vi.doMock('node:path', () => ({ basename: () => 'test', default: { basename: () => 'test default' } }));
  console.log('SAID a', read('/x/y'), (await import('node:path')).basename('/x/y'));
});
