import { test } from 'bun:test'; import { read } from './service.mjs'; globalThis.keep = read; test('b', () => { console.log('R b', read()); });
