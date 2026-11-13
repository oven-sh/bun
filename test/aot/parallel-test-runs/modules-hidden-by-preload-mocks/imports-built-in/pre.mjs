import { mock } from 'bun:test';
mock.module('./d.mjs', () => ({ get: () => 'P' }));
