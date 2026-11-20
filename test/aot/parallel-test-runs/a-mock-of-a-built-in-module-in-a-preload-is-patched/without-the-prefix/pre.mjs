import { mock } from 'bun:test';
mock.module('node:path', () => ({ basename: () => 'preload' }));
globalThis.atPreload = (await import('node:path')).basename();
