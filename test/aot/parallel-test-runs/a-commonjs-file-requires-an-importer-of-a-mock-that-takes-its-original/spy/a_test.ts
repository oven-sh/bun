import { test, vi, jest } from 'bun:test';
import { run } from './main';
import { mode, isReal } from './env';
vi.mock('./env', { spy: true });
test('a', () => { console.log('SAID', mode, typeof isReal, String(isReal()), run(), globalThis.envs); });
