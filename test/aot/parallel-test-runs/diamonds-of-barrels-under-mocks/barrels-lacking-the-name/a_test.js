import { test, vi } from 'bun:test';
const show = async (where, read) => {
  try { console.log('SAID', where, await read()); } catch (error) { console.log('SAID', where, error.name); }
};
test('reads the name', async () => {
  await show('first', async () => (await import('./user.js')).read());
  vi.doMock('./barrel2.js', () => ({}));
  await show('barrel2', async () => (await import('./user.js')).read());
  vi.doMock('./barrel1.js', () => ({ other: 1 }));
  await show('barrel1', async () => (await import('./user.js')).read());
  vi.resetModules?.();
  await show('anew', async () => (await import('./user.js')).read());
});
