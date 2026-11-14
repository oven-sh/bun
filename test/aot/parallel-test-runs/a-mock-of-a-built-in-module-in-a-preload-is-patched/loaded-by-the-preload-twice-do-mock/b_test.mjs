import { test } from 'bun:test';
import { read } from './lib.mjs';
test('b', async () => { console.log('SAID b', read('/x/y'), (await import('path')).basename('/x/y')); });
