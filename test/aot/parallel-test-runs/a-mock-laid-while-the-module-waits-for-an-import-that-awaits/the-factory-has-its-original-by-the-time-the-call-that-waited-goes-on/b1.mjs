import { vi } from 'bun:test';
vi.mock('./a1.mjs', async o => {
  globalThis.said.push('factory');
  await o();
  globalThis.said.push('original');
  return { v: 'ma' };
});
globalThis.said.push(await new Promise(d => setTimeout(d, 30, 'timer')));
