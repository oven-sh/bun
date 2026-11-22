import { mock, test } from 'bun:test';
import { run } from './main.mjs';
test('a', () => {
  mock.module('./env.mjs', () => ({ mode: 'M' }));
  console.log('SAID a', run());
});
