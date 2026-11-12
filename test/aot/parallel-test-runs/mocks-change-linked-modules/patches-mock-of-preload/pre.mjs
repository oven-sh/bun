import { mock } from 'bun:test'; mock.module('./db.mjs', () => ({ queries: 7 }));
