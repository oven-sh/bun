import { test, vi, mock } from 'bun:test';
test('b', async () => {
  
  vi.doMock('./e.mjs', async () => { await 0; return { val: 'test' }; });
  let said;
  try { said = require('./e.mjs').val; } catch (error) { said = error.name; }
  console.log('SAID b', said, globalThis.bodies);
  console.log('SAID import', (await import('./index.mjs')).val, (await import('./e.mjs')).val, globalThis.bodies);
});
