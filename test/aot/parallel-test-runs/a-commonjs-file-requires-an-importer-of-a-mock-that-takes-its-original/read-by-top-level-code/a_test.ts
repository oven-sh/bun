import { test, vi, jest } from 'bun:test';
import { run } from './main';
import { mode, isReal } from './env';
jest.mock('./env');
test('a', () => { console.log('SAID', mode, typeof isReal, String(isReal()), run(), globalThis.envs); });
