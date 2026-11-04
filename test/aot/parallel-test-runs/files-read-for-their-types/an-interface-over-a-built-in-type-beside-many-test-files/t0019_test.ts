import { test } from 'bun:test';
import { box18, make18 } from './src/b18';
test('b18', () => { if (box18.inner.extra + make18(1).inner.extra !== 19) console.log('SEEN wrong 18'); });
