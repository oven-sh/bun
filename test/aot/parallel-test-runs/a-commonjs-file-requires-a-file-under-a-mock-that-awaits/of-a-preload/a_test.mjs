import { test, vi } from 'bun:test';
import { run } from './main.mjs';

test('a', async () => { console.log('SAID', run(), globalThis.bodies, (await import('./store.mjs')).store.size); });
