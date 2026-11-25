import { mock, vi } from 'bun:test';
{ const a = await import('./db.mjs'); mock.module('./db.mjs', () => ({ ...a, q: 7 })); }
