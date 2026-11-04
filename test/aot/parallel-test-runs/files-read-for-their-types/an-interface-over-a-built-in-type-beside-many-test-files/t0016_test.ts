import { test } from 'bun:test';
import { box15, make15 } from './src/b15';
test('b15', () => { if (box15.inner.extra + make15(1).inner.extra !== 16) console.log('SEEN wrong 15'); });
