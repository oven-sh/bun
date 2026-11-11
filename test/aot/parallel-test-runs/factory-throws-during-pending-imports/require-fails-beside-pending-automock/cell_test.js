import { test, vi } from 'bun:test';
const tried = async read => { try { return String(await read()); } catch (error) { return 'threw ' + String(error.message).replace(/\/\S*\//g, '').slice(0, 60); } };
test('read', async () => {
  vi.doMock('./dep.mjs');
  const pending = import('./dep.mjs');
  console.log('SAID require ' + (await tried(() => Object.keys(import.meta.require('./dep.mjs')).sort().join('+'))));
  console.log('SAID import ' + (await tried(async () => (await pending).late)));
  console.log('SAID again ' + (await tried(async () => (await import('./dep.mjs')).late)));
});
