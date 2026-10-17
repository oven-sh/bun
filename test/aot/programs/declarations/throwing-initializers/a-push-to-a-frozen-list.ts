function grow(list: number[]): number[] { list.push(1); return list; }
export const made = grow(Object.freeze([0]) as number[]);
