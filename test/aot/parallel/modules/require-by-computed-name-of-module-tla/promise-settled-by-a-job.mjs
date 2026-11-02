export const a = await new Promise(resolve => queueMicrotask(() => resolve(1)));
