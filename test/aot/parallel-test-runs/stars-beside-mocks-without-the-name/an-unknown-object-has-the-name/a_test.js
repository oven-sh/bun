import { mock, test } from 'bun:test';
const made = { other: 2 };
made.f = () => 'mock f';
mock.module('./mocked.js', () => made);
const { use } = await import('./use.js');
test('reads', () => { console.log('SAID', use(), use()); });
