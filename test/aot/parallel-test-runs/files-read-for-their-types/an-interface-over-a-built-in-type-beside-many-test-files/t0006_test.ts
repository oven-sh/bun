import { test } from 'bun:test';
import { box5, make5 } from './src/b5';
test('b5', () => { if (box5.inner.extra + make5(1).inner.extra !== 6) console.log('SEEN wrong 5'); });
