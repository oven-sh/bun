export enum Level { Low = 1, High = 2 }
export enum Level { Low = 5 }
export function read() {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return (Level.Low === 5 ? "last" : "first") + ":" + Level.Low;
}
