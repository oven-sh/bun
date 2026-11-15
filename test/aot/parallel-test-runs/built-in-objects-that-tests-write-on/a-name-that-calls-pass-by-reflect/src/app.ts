export const read = (name: string): unknown => ({} as Record<string, unknown>)[name];
export const list = (name: string): unknown => ([] as unknown as Record<string, unknown>)[name];
export const keys = () => { const seen: string[] = []; for (const key in { own: 1 }) seen.push(key); return seen.join(); };
