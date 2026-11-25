import { mock, test } from 'bun:test';
mock.module('./mocked.js', () => ({ f: () => 'mock f' }));
const { use } = await import('./use.js');
test('reads', () => { console.log('SAID', use()); });
