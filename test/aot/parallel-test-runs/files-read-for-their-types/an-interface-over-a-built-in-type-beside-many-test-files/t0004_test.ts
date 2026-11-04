import { test } from 'bun:test';
import { box3, make3 } from './src/b3';
test('b3', () => { if (box3.inner.extra + make3(1).inner.extra !== 4) console.log('SEEN wrong 3'); });
