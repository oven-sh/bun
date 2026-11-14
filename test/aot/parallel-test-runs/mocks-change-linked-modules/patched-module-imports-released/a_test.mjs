import { test, mock, vi } from 'bun:test'; import './user.mjs';
test('a', async () => { mock.module('./state.mjs', () => ({ state: 'M' })); mock.module('./leaf.mjs', () => ({ leaf: 'N' })); vi.doUnmock('./leaf.mjs');
  const m = await import('./user.mjs'); console.log('R a', Object.keys(m).join(), m.state); vi.doUnmock('./state.mjs'); console.log('R held', m.state); });
