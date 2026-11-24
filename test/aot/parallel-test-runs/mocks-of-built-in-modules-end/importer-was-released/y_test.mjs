import { test, mock } from 'bun:test'; test('y', async () => { mock.module('node:path', () => ({ basename: () => 'M' })); console.log('R y', globalThis.kept()); });
