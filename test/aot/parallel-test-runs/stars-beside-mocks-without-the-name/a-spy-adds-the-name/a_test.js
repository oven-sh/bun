import { mock, spyOn, test } from 'bun:test';
mock.module('./mocked.js', () => ({ other: 2 }));
mock.module('./real.js', () => ({ count: 3 }));
const { use } = await import('./use.js');
test('reads', async () => {
  console.log('SAID', use());
  const all = await import('./barrel.js');
  const spy = spyOn(all, 'f').mockImplementation(() => 'spied');
  console.log('SAID', use(), spy.mock.calls.length);
  spy.mockRestore();
  console.log('SAID', use());
});
