import { test, vi, afterEach } from 'bun:test';
import { run as kept } from './user.mjs';
vi.mock('./env.mjs', () => ({ mode: 'mock', set() {} }));
afterEach(() => { vi.doUnmock('./env.mjs'); vi.resetModules(); });
for (const name of ['first', 'second']) test(name, async () => {
  const user = await import('./user.mjs');
  console.log('SAID', name, user.run(), kept());
  user.set('set');
  console.log('SAID', name, user.run(), kept());
});
