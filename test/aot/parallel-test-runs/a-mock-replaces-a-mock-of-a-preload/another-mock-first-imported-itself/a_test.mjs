import { test } from 'bun:test';
test('a', async () => { globalThis.held = await import('./e.mjs'); });
