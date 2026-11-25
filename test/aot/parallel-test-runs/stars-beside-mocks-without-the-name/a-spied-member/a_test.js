import { mock, spyOn, test } from 'bun:test';
import * as all from './barrel.js';
import { use } from './use.js';
mock.module('./mocked.js', () => ({ other: 2 }));
test('reads', () => {
  const spy = spyOn(all, 'f').mockImplementation(() => 'spied');
  console.log('SAID', use(), all.f());
  spy.mockRestore();
  console.log('SAID', use(), all.f());
});
