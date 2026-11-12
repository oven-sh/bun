import { test } from 'bun:test';
import { read } from './lib.mjs';
test('a', () => { console.log('SAID a', read('/x/y')); });
