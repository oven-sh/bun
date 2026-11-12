import { test, vi } from 'bun:test';
test('w', async () => {
  const b = await import('./b.mjs');
  console.log('SAID w', b.c());
  vi.doMock('node:path', () => ({ basename: () => 'M' }));
  console.log('SAID w', b.c(), (await import('./c.mjs')).c());
});
