import { mock } from 'bun:test';
mock.module('node:path', () => ({ basename: () => 'preload', default: { basename: () => 'preload default' } }));
