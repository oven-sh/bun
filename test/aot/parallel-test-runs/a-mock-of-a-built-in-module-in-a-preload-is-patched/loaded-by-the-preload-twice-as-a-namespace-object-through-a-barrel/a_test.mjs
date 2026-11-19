import { test, vi, mock } from 'bun:test';
import { read } from './index.mjs';
test('a', async () => {
  mock.module('node:path', () => ({ basename: () => 'test', default: { basename: () => 'test default' } }));
  console.log('SAID a', read('/x/y'), (await import('node:path')).basename('/x/y'));
});
