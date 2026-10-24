export type Mapped = { [K in "a"] };
declare function called(): void;
export function fallsThrough(n: number) { switch (n) { case 1: called(); case 2: called(); } }
export function labeled() { unused: for (;;) { break; } }
export function captured() { let later; const read = () => later; later = 1; return read; }
export class Members { items; constructor() { this.items = []; } }
