(globalThis as any).log.push("waits begins");
const got = await Promise.resolve(7);
(globalThis as any).log.push("waits goes on");
export const value = got;
