// a list is mapped over: what it holds may not decide whether the loop is one.
const whole: number[] = [], halves: number[] = [], data: number[] = JSON.parse("[0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5,9.5,10.5,11.5,12.5,13.5,14.5,15.5]");
for (let i = 0; i < 16; i++) { whole.push(i); halves.push(i + 0.5); }
export const loops: Record<string, (n: number) => number> = {
  "map over whole numbers": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (whole.map(x => x * 1.2)[i & 15]!)) | 0; return s; },
  "map over fractions": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (halves.map(x => x * 1.2)[i & 15]!)) | 0; return s; },
  "map over fractions out of data": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (data.map(x => x * 1.2)[i & 15]!)) | 0; return s; },
};
