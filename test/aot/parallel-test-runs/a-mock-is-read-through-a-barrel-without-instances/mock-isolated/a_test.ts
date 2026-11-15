import { test, vi } from 'bun:test';
import * as index from './index';
vi.mock('./env', () => ({ mode: 'mock' }));
test('a', async () => { await import('./main'); let said; try { said = (index as any).mode; } catch (error) { said = error.constructor.name; } console.log('SAID', said, Object.keys(index).sort().join()); });
