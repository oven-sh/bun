export const facts = () => [typeof fetch, typeof process.cwd(), process.platform === "never", typeof Bun.which, (globalThis as any).added].join();
