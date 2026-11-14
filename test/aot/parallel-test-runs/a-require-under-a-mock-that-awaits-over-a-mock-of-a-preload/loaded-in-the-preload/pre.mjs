import { mock } from 'bun:test';
mock.module('./e.mjs', () => ({ val: 'preload', set() {} }));
await import('./e.mjs');
