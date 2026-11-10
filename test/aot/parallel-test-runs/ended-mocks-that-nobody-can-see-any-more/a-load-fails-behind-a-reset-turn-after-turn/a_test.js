import { test, vi } from 'bun:test';
async function tell(name, refs, word) {
  for (let turn = 0; turn < 12; turn++) {
    Bun.gc(true);
    await new Promise(done => setTimeout(done, 5));
  }
  let alive = 0;
  for (const ref of refs) if (ref.deref()) alive++;
  console.log(name, refs.length, alive * 4 > refs.length ? 'HELD' : 'let go', word);
}
const refs = [];
function made(n) {
  const it = { x: 'mock ' + n, y: new Array(200).fill(n) };
  refs.push(new WeakRef(it));
  return it;
}
test('h-fails', async () => {
  let word = 0;
  for (let n = 0; n < 50; n++) {
    vi.resetModules();
    vi.doMock('./part.mjs', () => made(n));
    word += (await import('./user.mjs')).look().length;
    try {
      await import('./fails.mjs');
    } catch (error) {
      word += error.message.length;
    }
    vi.doUnmock('./part.mjs');
  }
  await tell('h-fails 50', refs, word);
});
