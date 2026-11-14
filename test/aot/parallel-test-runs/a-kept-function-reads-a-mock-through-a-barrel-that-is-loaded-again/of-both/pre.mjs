import { mock } from 'bun:test';
mock.module('./env.mjs', () => ({ mode: 'preload', set() {} }));
