import { test } from 'bun:test';
import { box6, make6 } from './src/b6';
test('b6', () => { if (box6.inner.extra + make6(1).inner.extra !== 7) console.log('SEEN wrong 6'); });
