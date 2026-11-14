import { mock, test } from 'bun:test';
import { use } from './use.js';
test('reads', () => { console.log('SAID', use()); mock.module('./mocked.js', () => ({ other: 2 })); console.log('SAID', use()); });
