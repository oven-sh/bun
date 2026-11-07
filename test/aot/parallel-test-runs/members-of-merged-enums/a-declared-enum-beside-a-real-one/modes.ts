declare enum Speed { Off, Fast }
enum Speed { Slow = 2 }
export function read() {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return (Speed.Fast === 1 ? "folded" : "read at run time") + ":" + String(Speed.Fast) + ":" + Speed.Slow;
}
