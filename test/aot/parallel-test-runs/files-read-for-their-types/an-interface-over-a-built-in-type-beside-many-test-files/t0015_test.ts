import { test } from 'bun:test';
import { box14, make14 } from './src/b14';
test('b14', () => { if (box14.inner.extra + make14(1).inner.extra !== 15) console.log('SEEN wrong 14'); });
