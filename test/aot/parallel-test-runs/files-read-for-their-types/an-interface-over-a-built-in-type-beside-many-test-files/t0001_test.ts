import { test } from 'bun:test';
import { box0, make0 } from './src/b0';
test('b0', () => { if (box0.inner.extra + make0(1).inner.extra !== 1) console.log('SEEN wrong 0'); });
