// a list is filtered and asked.
const whole: number[] = [], halves: number[] = [], data: number[] = JSON.parse("[0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5,9.5,10.5,11.5,12.5,13.5,14.5,15.5]");
for (let i = 0; i < 16; i++) { whole.push(i); halves.push(i + 0.5); }
export const loops: Record<string, (n: number) => number> = {
  "filter over whole numbers": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (whole.filter(x => x > 5).length)) | 0; return s; },
  "filter over fractions": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (halves.filter(x => x > 5).length)) | 0; return s; },
  "some over whole numbers": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + ((whole.some(x => x > 14) ? 1 : 2))) | 0; return s; },
  "some over fractions": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + ((halves.some(x => x > 14) ? 1 : 2))) | 0; return s; },
  "a fold over whole numbers": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (whole.reduce((a, b) => a - b, 0))) | 0; return s; },
  "a fold over fractions": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (halves.reduce((a, b) => a - b, 0))) | 0; return s; },
};
