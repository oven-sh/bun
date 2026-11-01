export namespace N { export const a = 1; export let b = 2; export function bump() { b++; } }
export const read = () => [N.a, N.b].join();
