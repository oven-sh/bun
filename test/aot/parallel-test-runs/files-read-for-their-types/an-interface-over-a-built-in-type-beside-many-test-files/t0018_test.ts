import { test } from 'bun:test';
import { box17, make17 } from './src/b17';
test('b17', () => { if (box17.inner.extra + make17(1).inner.extra !== 18) console.log('SEEN wrong 17'); });
