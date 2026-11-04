import { test } from 'bun:test';
import { box2, make2 } from './src/b2';
test('b2', () => { if (box2.inner.extra + make2(1).inner.extra !== 3) console.log('SEEN wrong 2'); });
