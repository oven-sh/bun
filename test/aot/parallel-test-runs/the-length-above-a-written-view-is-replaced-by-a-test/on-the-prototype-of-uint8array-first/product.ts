export function total(a: Uint8Array): number { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]!; return s; }
export function turns(a: Uint8Array): number { let n = 0; for (let i = 0; i < a.length; i++) n++; return n; }
export function loud(a: Uint8Array, heard: (at: number) => void): number { let s = 0; for (let i = 0; i < a.length; i++) { heard(i); s += a.length; } return s; }
