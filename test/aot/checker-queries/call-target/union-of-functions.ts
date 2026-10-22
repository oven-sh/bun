// A signature the checker composed for a union has no declaration and nothing written.
declare const u: ((a: number) => void) | ((a: string) => void);
u(1 as never);
