import { test } from 'bun:test';
import { box8, make8 } from './src/b8';
test('b8', () => { if (box8.inner.extra + make8(1).inner.extra !== 9) console.log('SEEN wrong 8'); });
