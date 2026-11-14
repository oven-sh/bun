import { test, vi } from 'bun:test';
import * as d from './d.mjs';
import { b } from './b.mjs';
test('t', async () => {
  console.log('SAID', b());
  vi.doUnmock('./d.mjs');
  console.log('SAID', (await import('./index.mjs')).get(), d.get());
});
