import { test } from 'bun:test';
import { box1, make1 } from './src/b1';
test('b1', () => { if (box1.inner.extra + make1(1).inner.extra !== 2) console.log('SEEN wrong 1'); });
