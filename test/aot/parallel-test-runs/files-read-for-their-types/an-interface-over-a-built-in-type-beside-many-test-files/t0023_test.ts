import { test } from 'bun:test';
import { box22, make22 } from './src/b22';
test('b22', () => { if (box22.inner.extra + make22(1).inner.extra !== 23) console.log('SEEN wrong 22'); });
