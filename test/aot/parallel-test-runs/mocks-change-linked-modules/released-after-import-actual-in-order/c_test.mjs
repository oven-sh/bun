vi.mock('./service.mjs', async () => ({ ...(await vi.importActual('./service.mjs')), start: () => 'mocked' }));
