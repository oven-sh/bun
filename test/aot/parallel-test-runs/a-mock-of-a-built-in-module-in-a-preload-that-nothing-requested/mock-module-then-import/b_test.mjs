import { test } from 'bun:test';
test('b', async () => { console.log('SAID b', (await import('./index.mjs')).d('/x/y'), (await import('node:path')).basename('/x/y')); });
