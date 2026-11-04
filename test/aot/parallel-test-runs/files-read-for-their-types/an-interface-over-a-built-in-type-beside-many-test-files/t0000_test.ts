import { test } from 'bun:test';
import { first } from './src/a';
test('first', () => { console.log('SEEN', first()); });
