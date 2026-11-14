import { mock, test } from 'bun:test';
mock.module('./mocked.js', () => ({ other: 2 }));
const all = await import('./barrel.js');
test('reads', () => { console.log('SAID', all.f(), all.other, Object.keys(all).join()); });
