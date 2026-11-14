import { test, vi, mock } from 'bun:test';
import { basename } from 'node:path';
import { d } from './index.mjs';
test('a', async () => {
  console.log('SAID', basename('/x/y'), d('/x/y'));
  vi.doMock('node:path', () => ({ basename: () => 'test' }));
  console.log('SAID', basename('/x/y'), d('/x/y'));
});
