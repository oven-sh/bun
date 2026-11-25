import { test, vi } from 'bun:test';
test('z', async () => {
  const x = await import('./index.mjs');
  console.log('SAID z', x.c());
  vi.doUnmock('node:path');
  console.log('SAID z', x.c(), (await import('./c.mjs')).c());
});
