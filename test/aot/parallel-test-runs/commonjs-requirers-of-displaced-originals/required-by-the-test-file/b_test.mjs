import { test } from 'bun:test';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const said = globalThis.said ??= [];
function say(x) { said.push(x); }
async function get(n, load) { try { const m = await load(); say(n + '=' + (m.seen ? m.seen() : m.x)); } catch (e) { say(n + ' threw ' + String(e.message).slice(0, 24)); } }
test('b', async () => {
  await get('user', () => import('./user.mjs'));
  await get('cr', () => req('./cr.cjs'));
  console.log('R b ' + said.splice(0).join(' '));
});
