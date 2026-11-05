export type Box = { name: string; late?: number };
export function make(name: string) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const box: Box = { name };
  box.late = 1;
  return box;
}
export function nameOf(box: Box) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return box.name; }
