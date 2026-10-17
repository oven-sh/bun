type Cell = { n: number };
const cells: Array<Cell | null> = [{ n: 1 }, null];
export const made = cells.map(cell => cell!.n);
