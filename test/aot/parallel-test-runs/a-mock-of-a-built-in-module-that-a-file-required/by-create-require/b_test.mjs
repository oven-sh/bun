import { test, vi } from 'bun:test';
import { read } from './lib.mjs';
vi.mock('node:path', () => ({ basename: () => 'test', default: { basename: () => 'test default' } }));
test('b', async () => { console.log('SAID b', read('/x/y'), (await import('node:path')).basename('/x/y')); });
