import { test, vi } from 'bun:test';
const show = async (where, read) => {
  try { console.log('SAID', where, await read()); } catch (error) { console.log('SAID', where, error.name); }
};
test('reads the name', async () => {
  await show('first', async () => (await import('./user.js')).read());
  vi.doMock('./left0.js', () => ({ word: 'left' }));
  await show('left0', async () => (await import('./user.js')).read());
  vi.doMock('./right1.js', () => ({ word: 'right' }));
  await show('right1', async () => (await import('./user.js')).read());
  vi.resetModules?.();
  await show('anew', async () => (await import('./user.js')).read());
});
