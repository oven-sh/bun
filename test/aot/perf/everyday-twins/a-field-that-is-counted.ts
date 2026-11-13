// a total lies in a field.
const whole: number[] = [], halves: number[] = [], data: number[] = JSON.parse("[0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5,9.5,10.5,11.5,12.5,13.5,14.5,15.5]");
for (let i = 0; i < 16; i++) { whole.push(i); halves.push(i + 0.5); }
class Meter {
  total = 0; steps = 0;
  inALocal(list: number[]): number { let t = this.total; for (let i = 0; i < list.length; i++) t += list[i]!; this.total = t; return t; }
  inTheField(list: number[]): number { for (let i = 0; i < list.length; i++) this.total += list[i]!; return this.total; }
  stepsInALocal(list: number[]): number { let k = this.steps; for (let i = 0; i < list.length; i++) if (list[i]! > 3) k++; this.steps = k; return k; }
  stepsInTheField(list: number[]): number { for (let i = 0; i < list.length; i++) if (list[i]! > 3) this.steps++; return this.steps; }
  startsOffTheList(list: number[]): number { let m = list[0]!; for (let i = 0; i < list.length; i++) if (list[i]! > m) m = list[i]!; return m; }
  startsWithANumber(list: number[]): number { let m = -Infinity; for (let i = 0; i < list.length; i++) if (list[i]! > m) m = list[i]!; return m; }
}
const meter = new Meter();
export const loops: Record<string, (n: number) => number> = {
  "a total in a local": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (meter.inALocal(halves) % 7)) | 0; return s; },
  "a total in a field": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (meter.inTheField(halves) % 7)) | 0; return s; },
  "a counter in a local": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (meter.stepsInALocal(whole) % 7)) | 0; return s; },
  "a counter in a field": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (meter.stepsInTheField(whole) % 7)) | 0; return s; },
  "the greatest, from a number on": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (meter.startsWithANumber(halves))) | 0; return s; },
  "the greatest, from the first on": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) s = (s + (meter.startsOffTheList(halves))) | 0; return s; },
};
