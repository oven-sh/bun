import { test, vi } from 'bun:test';
import { run } from './main';
test('b', async () => { await (vi as any).importMock('./env'); require('./legacy.cjs'); run(); });
