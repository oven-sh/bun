import { test } from 'bun:test';
import { box21, make21 } from './src/b21';
test('b21', () => { if (box21.inner.extra + make21(1).inner.extra !== 22) console.log('SEEN wrong 21'); });
