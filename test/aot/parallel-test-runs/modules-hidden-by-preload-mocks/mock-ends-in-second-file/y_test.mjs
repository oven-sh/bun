import { test, vi } from 'bun:test';
import { b } from './b.mjs';
test('t', async () => {
  console.log('SAID', b());
  vi.doUnmock('./d.mjs');
  console.log('SAID', (await import('./index.mjs')).get());
});
