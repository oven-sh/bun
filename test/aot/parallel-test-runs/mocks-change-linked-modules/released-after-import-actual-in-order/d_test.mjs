import { mock } from 'bun:test'; import { loadService } from './lazy.mjs';
test('d', async () => { mock.module('./logger.mjs', () => ({ })); console.log('R d', await loadService().catch(e => e.message)); });
