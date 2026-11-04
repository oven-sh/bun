namespace N {
  export function early(): string { return typeof N.late + " " + typeof N.x + " " + typeof (N as any).last + " " + Object.keys(N).join(); }
  export const x = early();
  export function late(): number { return 1; }
  export const y = early();
  export let last = 2;
}
function often(): string { let s = ""; for (let i = 0; i < 2; i++) s += N.early() + ";"; return s; }
console.log(N.x); console.log(N.y); console.log(often());
