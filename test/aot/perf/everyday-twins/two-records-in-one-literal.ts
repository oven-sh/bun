// two typed records are laid into one. The names are this file's own: records with the same names are one kind to the engine, wherever they are made.
interface Half { left: number; label: string; open: boolean; size: number }
interface Both extends Half { depth: number }
let kept: Both = { left: 1, label: "b", open: true, size: 2, depth: 4 };
let first: Half = { left: 1, label: "b", open: true, size: 2 };
const second = { size: 3, depth: 4 };
export const loops: Record<string, (n: number) => number> = {
  "both written out": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + ((kept = { left: first.left, label: first.label, open: first.open, size: second.size, depth: second.depth }).depth)) | 0; first = kept; return s; },
  "two records in one literal": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + ((kept = { ...first, ...second }).depth)) | 0; first = kept; return s; },
};
