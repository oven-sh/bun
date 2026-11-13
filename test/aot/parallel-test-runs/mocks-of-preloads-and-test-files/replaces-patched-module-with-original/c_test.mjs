import { test, mock, vi, jest } from 'bun:test';
globalThis.kept ??= [];
const say = (...a) => console.log('R', ...a);
const attempt = f => { try { return f(); } catch (e) { return '!' + e?.constructor?.name; } };
const all = async m => `${m.at} ${attempt(() => m.read())} ${attempt(() => m.keys())} ${attempt(() => m.again)} ${attempt(() => m.twice?.())} ${await m.same()}`;
const get = () => import('./top.mjs');
test('c', async () => {
  const m = await get(); say('c', await all(m)); globalThis.kept.push(m);
  say('kept', globalThis.kept.map(k => attempt(() => k.read())).join(), globalThis.kept.map(k => attempt(() => k.keys())).join(';'));
  say('again', await all(await import('./top.mjs')), (await import('./db.mjs')).q);
});
