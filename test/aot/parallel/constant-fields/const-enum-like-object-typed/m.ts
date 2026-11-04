export const E = { A: 0, B: 1 } as const;
export const F: { A: number; B: number } = { A: 0, B: 1 };
export const read = () => [E.A, E.B, F.A, F.B].join();
