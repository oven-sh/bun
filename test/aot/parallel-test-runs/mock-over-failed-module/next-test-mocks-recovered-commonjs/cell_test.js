import { expect, mock, test, vi } from 'bun:test';
const tried = async read => { try { return String(await read()); } catch (error) { return 'threw ' + error.message.replace(/\/\S*\//g, ''); } };
test('a file that is not ready fails', async () => {
  vi.doMock('./dep.cjs', async original => ({ ...(await original()), flag: 'over' }));
  await expect(import('./dep.cjs')).rejects.toThrow('not ready');
});
test('a file that is ready is mocked', async () => {
  globalThis.ready = true;
  vi.doMock('./dep.cjs', async original => ({ ...(await original()), flag: 'over' }));
  const { flag } = await import('./dep.cjs');
  console.log('SAID flag ' + flag);
  expect(flag).toBe('over');
});
