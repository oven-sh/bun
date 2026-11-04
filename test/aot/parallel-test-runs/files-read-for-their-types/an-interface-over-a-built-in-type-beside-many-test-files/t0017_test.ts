import { test } from 'bun:test';
import { box16, make16 } from './src/b16';
test('b16', () => { if (box16.inner.extra + make16(1).inner.extra !== 17) console.log('SEEN wrong 16'); });
