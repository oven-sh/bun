import { test, mock, vi } from 'bun:test';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const said = globalThis.said ??= [];
function say(x) { said.push(x); }
async function get(n, load) { try { const m = await load(); say(n + '=' + (m.seen ? m.seen() : m.x)); } catch (e) { say(n + ' threw ' + String(e.message).slice(0, 24)); } }
test('a', async () => {
  await get('rdep', () => req('./dep.mjs'));
  mock.module('./dep.mjs', () => { say('f1'); return { x: 'm1' }; });
  await get('rdep', () => req('./dep.mjs'));
  vi.doMock('./dep.mjs', async () => { say('f2'); return { ...(await vi.importActual('./dep.mjs')), x: 'm2' }; });
  await get('cr', () => req('./cr.cjs'));
  await get('dep', () => import('./dep.mjs'));
  console.log('R a ' + said.splice(0).join(' '));
});
