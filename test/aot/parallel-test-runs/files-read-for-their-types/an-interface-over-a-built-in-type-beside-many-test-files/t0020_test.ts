import { test } from 'bun:test';
import { box19, make19 } from './src/b19';
test('b19', () => { if (box19.inner.extra + make19(1).inner.extra !== 20) console.log('SEEN wrong 19'); });
