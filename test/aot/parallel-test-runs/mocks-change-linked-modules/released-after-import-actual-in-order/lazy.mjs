export const loadService = async () => { const m = await import('./service.mjs'); return m.start(); };
