import { test } from 'bun:test';
test('c', async () => { console.log('SAID c', (await import('./e.mjs')).val, require('./e.mjs').val, globalThis.bodies); });
