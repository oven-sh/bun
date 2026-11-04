import { test } from 'bun:test';
import { box23, make23 } from './src/b23';
test('b23', () => { if (box23.inner.extra + make23(1).inner.extra !== 24) console.log('SEEN wrong 23'); });
