export let moving = 1;
export const shared = { a: 1 };
export function change(): void { moving = 10; shared.a = 9; }
