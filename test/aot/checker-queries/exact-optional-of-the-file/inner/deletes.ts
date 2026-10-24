// What may be deleted is a rule that only reports, so it is asked of the file.
export interface Box { value: number | undefined; size: number }
export function clear(box: Box): number { delete box.value; return box.size; }
export function shrink(box: Box): void { delete box.size; }
