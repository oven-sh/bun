import { expect, mock, test, vi } from 'bun:test';
const tried = async read => { try { return String(await read()); } catch (error) { return 'threw ' + error.message.replace(/\/\S*\//g, ''); } };
test('read', async () => {
  vi.doMock('./dep.cjs', async original => ({ ...(await original()), flag: 'over' }));
  console.log('SAID import ' + (await tried(async () => (await import('./dep.cjs')).flag)));
  vi.doMock('./dep.cjs', async original => ({ ...(await original()), flag: 'over' }));
  console.log('SAID import ' + (await tried(async () => (await import('./dep.cjs')).flag)));
  await new Promise(done => setImmediate(done));
  console.log('SAID end ' + globalThis.runs);
});
