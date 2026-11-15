import { test } from 'bun:test';
test('a', async () => { await import('./index.mjs'); });
