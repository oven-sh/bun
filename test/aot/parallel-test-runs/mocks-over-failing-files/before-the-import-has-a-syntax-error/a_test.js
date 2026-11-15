import { test, vi } from 'bun:test';
const show = async (where, read) => {
  try { console.log('SAID', where, await read()); } catch (error) { console.log('SAID', where, error.name); }
};
test('reads the mock', async () => {
  vi.doMock('./bad.js', () => ({ word: 'mock' }));
  await show('user', async () => (await import('./user.js')).read());
  await show('itself', async () => (await import('./bad.js')).word);
});
