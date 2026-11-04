import { test } from 'bun:test';
import { box10, make10 } from './src/b10';
test('b10', () => { if (box10.inner.extra + make10(1).inner.extra !== 11) console.log('SEEN wrong 10'); });
