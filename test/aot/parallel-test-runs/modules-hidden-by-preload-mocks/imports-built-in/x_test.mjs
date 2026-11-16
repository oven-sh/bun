import { test, vi } from 'bun:test';
import { b } from './b.mjs';
test('t', async () => {
  console.log('SAID', b());
  vi.doUnmock('./d.mjs');
  const x = await import('./index.mjs');
  console.log('SAID', x.get());
  console.log('SAID', b());
});
