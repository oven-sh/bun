import { test, vi } from 'bun:test';
import { use } from './use.js';
vi.mock('./mocked.js', async original => ({ ...(await original()), other: 2 }));
test('reads', () => { console.log('SAID', use(), use()); });
