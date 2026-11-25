import { test, vi } from 'bun:test';
import { read } from './near.js';
vi.mock('./bad.js', () => ({ word: 'mock' }));
test('reads the mock', () => { console.log('SAID', read()); });
