type Event = { n: number; log: string };
const listeners: ((e: Event) => void)[] = [
  e => {
    e.n++;
  },
  e => {
    e.n += 2;
    e.log += "b";
  },
  e => {
    if (e.n > 20) throw new RangeError("enough at " + e.n);
  },
];
function emit(e: Event): void {
  for (let i = 0; i < listeners.length; i++) listeners[i](e);
}
const event: Event = { n: 0, log: "" };
try {
  for (let round = 0; round < 20; round++) emit(event);
} catch (error) {
  console.log((error as Error).message);
}
console.log(event.n, event.log);
