import { test } from 'bun:test';
import { box9, make9 } from './src/b9';
test('b9', () => { if (box9.inner.extra + make9(1).inner.extra !== 10) console.log('SEEN wrong 9'); });
