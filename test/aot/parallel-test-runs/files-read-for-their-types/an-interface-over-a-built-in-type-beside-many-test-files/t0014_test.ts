import { test } from 'bun:test';
import { box13, make13 } from './src/b13';
test('b13', () => { if (box13.inner.extra + make13(1).inner.extra !== 14) console.log('SEEN wrong 13'); });
