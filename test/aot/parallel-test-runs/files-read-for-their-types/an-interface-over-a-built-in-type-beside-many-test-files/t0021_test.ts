import { test } from 'bun:test';
import { box20, make20 } from './src/b20';
test('b20', () => { if (box20.inner.extra + make20(1).inner.extra !== 21) console.log('SEEN wrong 20'); });
