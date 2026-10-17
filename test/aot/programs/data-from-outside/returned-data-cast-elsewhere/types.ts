export interface Row {
  id: number;
  name: string;
}
export interface Line {
  id: number;
  name: string;
}
export interface RowHolder {
  held: Row;
}
export interface LineHolder {
  held: Line;
}
export function widen(holder: RowHolder): LineHolder {
  return holder as LineHolder;
}
