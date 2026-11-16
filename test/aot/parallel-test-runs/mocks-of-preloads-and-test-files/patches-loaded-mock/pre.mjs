import { mock, vi } from 'bun:test';
mock.module('./db.mjs', () => ({ q: 7 }));
