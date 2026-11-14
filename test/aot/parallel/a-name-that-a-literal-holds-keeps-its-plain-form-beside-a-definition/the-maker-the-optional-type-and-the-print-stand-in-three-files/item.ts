export const pair = (name: string, size: number) => ({ name, size });
export function lock(o: { name: string; size: number }) { Object.defineProperty(o, "name", { writable: false }); }
