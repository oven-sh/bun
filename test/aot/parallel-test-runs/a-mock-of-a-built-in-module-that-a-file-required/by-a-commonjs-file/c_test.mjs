import { test } from 'bun:test';
import { read } from './lib.mjs';
test('c', () => { console.log('SAID c', read('/x/y')); });
