import { test, vi } from 'bun:test';
const show = async make => {
  try {
    console.log('SAID', String(await make()));
  } catch (error) {
    console.log('SAID', error?.name);
  }
};
test('reads', async () => {
  await show(async () => (await import('./user.js')).read());
  vi.doMock('./bad.js', () => ({ word: 'mock' }));
  await show(async () => (await import('./user.js')).read());
  await show(async () => (await import('./bad.js')).word);
});
