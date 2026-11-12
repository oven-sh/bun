import { test, vi } from 'bun:test';
test('y', async () => {
  const x = await import('./index.mjs');
  console.log('SAID y', x.c());
  vi.doUnmock('node:path');
  console.log('SAID y', x.c(), (await import('./c.mjs')).c());
});
