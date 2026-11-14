import { test, mock } from 'bun:test';
test('a', async () => { mock.module('node:path', () => ({ basename: () => 'test' })); console.log('SAID a', (await import('node:path')).basename('/x/y')); });
