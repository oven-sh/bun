import { test, mock } from 'bun:test';
test('w', async () => {
  const b = await import('./b.mjs');
  console.log('SAID w', b.c());
  mock.module('node:path', () => ({ basename: () => 'M' }));
  console.log('SAID w', b.c(), (await import('./c.mjs')).c());
});
