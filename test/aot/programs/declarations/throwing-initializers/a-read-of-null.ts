type Cell = { next: Cell | null; n: number };
function second(cell: Cell): { n: number } { return { n: cell.next!.n }; }
export const made = second({ next: null, n: 1 });
