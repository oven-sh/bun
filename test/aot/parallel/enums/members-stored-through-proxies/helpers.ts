export const make = (target: object): any => new Proxy(target, {});
export function set(target: any, key: string, value: unknown) { target[key] = value; return true; }
export const named = (name: string) => name;
