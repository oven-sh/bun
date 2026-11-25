import { test, vi } from 'bun:test';
import { b } from './b.mjs';
test('t', async () => {
  console.log('SAID', b());
  const a = await vi.importActual('./d.mjs');
  console.log('SAID', a.get(), b());
  vi.doUnmock('./d.mjs');
  console.log('SAID', (await import('./index.mjs')).get());
});
