import { test } from 'bun:test';
test('a', async () => { globalThis.held = require('./e.mjs'); });
