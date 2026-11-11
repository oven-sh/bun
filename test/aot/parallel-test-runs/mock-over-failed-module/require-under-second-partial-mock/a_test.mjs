import { expect, mock, test, vi } from 'bun:test';
import { createRequire } from 'node:module';
const tried = async read => { try { return String(await read()); } catch (error) { return 'threw ' + error.message.replace(/\/\S*\//g, ''); } };
test('read', async () => {
  vi.doMock('./dep.cjs', async original => ({ ...(await original()), flag: 'over' }));
  console.log('SAID import ' + (await tried(async () => (await import('./dep.cjs')).flag)));
  vi.doMock('./dep.cjs', async original => ({ ...(await original()), flag: 'over' }));
  console.log('SAID require ' + (await tried(() => import.meta.require('./dep.cjs').flag)));
  console.log('SAID import ' + (await tried(async () => (await import('./dep.cjs')).flag)));
  console.log('SAID end ' + globalThis.runs);
});
