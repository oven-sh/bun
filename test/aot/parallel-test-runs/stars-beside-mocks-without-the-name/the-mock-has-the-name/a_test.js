import { mock, test } from 'bun:test';
mock.module('./mocked.js', () => ({ other: 2, f: () => 'mock f' }));
const { use } = await import('./use.js');
test('reads', () => { console.log('SAID', use(), use()); });
