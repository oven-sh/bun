import { test } from 'bun:test';
import { basename } from 'node:path';
test('c', async () => { console.log('SAID c', basename('/x/y'), (await import('./d.mjs')).d('/x/y')); });
