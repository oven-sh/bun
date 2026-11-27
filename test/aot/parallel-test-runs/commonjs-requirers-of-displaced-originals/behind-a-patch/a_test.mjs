import { test, vi, jest } from 'bun:test';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const said = globalThis.said ??= [];
function say(x) { said.push(x); }
async function get(n, load) { try { const m = await load(); say(n + '=' + (m.seen ? m.seen() : m.x)); } catch (e) { say(n + ' threw ' + String(e.message).slice(0, 24)); } }
test('a', async () => {
  await get('k', () => req('./k.cjs'));
  jest.doMock('./dep.mjs', () => { say('f1'); return { x: 'm1' }; });
  await get('dep', () => import('./dep.mjs'));
  vi.doMock('./dep.mjs', async () => { say('f2'); await 0; return { x: 'm2' }; });
  await get('cr', () => req('./cr.cjs'));
  await get('dep', () => import('./dep.mjs'));
  console.log('R a ' + said.splice(0).join(' '));
});
