const print = console.log;
interface Dial { first(): number; second(): number; third(): number; fourth(): number; fifth(): number; sixth(): number; seventh(): number; eighth(): number; ninth(): number; tenth(): number; size: number; eleventh(): number; twelfth(): number; }
function measure(n: number): number { print("measured", n); return n * 2; }
function makeDial(start: number): Dial { let at = start; return { first: () => at + 0, second: () => at + 1, third: () => at + 2, fourth: () => at + 3, fifth: () => at + 4, sixth: () => at + 5, seventh: () => at + 6, eighth: () => at + 7, ninth: () => at + 8, tenth: () => at + 9, size: measure(at), eleventh: () => at + 10, twelfth: () => ++at }; }
const dial = makeDial(10); print(dial.twelfth(), dial.tenth(), dial.size, dial.eleventh(), Object.keys(dial).join());
const other = makeDial(100); print(other.twelfth(), other.size, other.eleventh(), dial.eleventh());
