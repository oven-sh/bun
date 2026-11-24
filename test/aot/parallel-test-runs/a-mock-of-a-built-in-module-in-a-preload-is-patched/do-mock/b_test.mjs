import { test } from 'bun:test';
import { basename } from 'node:path';
test('b', async () => { console.log('SAID b', basename('/x/y'), (await import('./d.mjs')).d('/x/y')); });
