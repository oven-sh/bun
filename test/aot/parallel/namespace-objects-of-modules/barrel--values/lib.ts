export let state = 1;
export const box = { value: 1 };
export function check(x: number): number { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return ((x as any) + 1) as number; }
export function bump(): void { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; state++; }
export function readBox(): string { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return typeof box.value + ":" + String(box.value); }
