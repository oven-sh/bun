import { test } from 'bun:test';
import { box7, make7 } from './src/b7';
test('b7', () => { if (box7.inner.extra + make7(1).inner.extra !== 8) console.log('SEEN wrong 7'); });
