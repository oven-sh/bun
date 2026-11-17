import { test, vi } from 'bun:test';
import * as index from './index';

vi.mock('./env', () => ({ own: 'mock own' }));
test('a', async () => { await import('./main'); const read = (n: string) => { try { return (index as any)[n]; } catch (error) { return error.constructor.name; } }; console.log('SAID', read('mode'), read('own'), read('kept'), (index as any).mode, Object.keys(index).sort().join()); });
