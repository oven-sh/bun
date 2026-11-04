import { test } from 'bun:test';
import { box11, make11 } from './src/b11';
test('b11', () => { if (box11.inner.extra + make11(1).inner.extra !== 12) console.log('SEEN wrong 11'); });
