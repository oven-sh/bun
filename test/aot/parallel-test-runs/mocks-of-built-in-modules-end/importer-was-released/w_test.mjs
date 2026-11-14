import { test, mock } from 'bun:test'; mock.module('pkg', () => ({ p: () => 'H' })); test('w', async () => { const x = await import('./a.mjs'); globalThis.kept = x.a; console.log('R w', x.a()); });
