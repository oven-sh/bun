import { test } from 'bun:test';
import { box4, make4 } from './src/b4';
test('b4', () => { if (box4.inner.extra + make4(1).inner.extra !== 5) console.log('SEEN wrong 4'); });
