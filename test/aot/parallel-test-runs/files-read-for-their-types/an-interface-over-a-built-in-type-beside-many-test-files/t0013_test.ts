import { test } from 'bun:test';
import { box12, make12 } from './src/b12';
test('b12', () => { if (box12.inner.extra + make12(1).inner.extra !== 13) console.log('SEEN wrong 12'); });
