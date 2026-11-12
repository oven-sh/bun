import { test, vi, afterEach } from 'bun:test';
import { run as kept } from './user.mjs';

afterEach(() => { vi.doUnmock('./env.mjs'); vi.resetModules(); });
for (const name of ['first', 'second']) test(name, async () => {
  const user = await import('./user.mjs');
  console.log('SAID', name, user.run(), kept());
  user.set('set');
  console.log('SAID', name, user.run(), kept());
});
