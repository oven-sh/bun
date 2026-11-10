import { vi } from 'bun:test';
vi.mock('./a1.mjs', async o => {
  const got = await o().then(m => 'o given', e => 'o refused ' + e.message);
  globalThis.said.push(got);
  return { v: 'ma' };
});
await new Promise(d => setTimeout(d, 30));
export const b = 1;
