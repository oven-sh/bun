import { test } from 'bun:test';
import { run } from './main.mjs';
test('b', () => {
  console.log('SAID b', run());
});
