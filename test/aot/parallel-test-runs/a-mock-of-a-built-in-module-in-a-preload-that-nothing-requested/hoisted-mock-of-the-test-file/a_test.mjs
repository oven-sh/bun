import { test, vi } from 'bun:test';
import { d } from './index.mjs';
vi.mock('node:path', () => ({ basename: () => 'test' }));
test('a', () => { console.log('SAID a', d('/x/y')); });
