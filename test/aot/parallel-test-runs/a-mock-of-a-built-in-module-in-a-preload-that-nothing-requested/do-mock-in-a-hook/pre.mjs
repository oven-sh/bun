import { mock } from 'bun:test';
mock.module('node:path', () => ({ basename: () => 'preload' }));
