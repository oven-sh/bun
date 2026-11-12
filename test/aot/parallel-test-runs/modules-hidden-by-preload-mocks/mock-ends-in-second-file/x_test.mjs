import { test, vi } from 'bun:test';
import { b } from './b.mjs';
test('t', async () => {
  console.log('SAID', b());
});
