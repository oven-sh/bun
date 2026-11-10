const print = console.log;
interface Dial { first(): number; second(): number; third(): number; fourth(): number; fifth(): number; sixth(): number; seventh(): number; eighth(): number; ninth(): number; tenth(): number; eleventh(): number; twelfth(): number; }
function makeDial(start: number): Dial { let at = start; return { first: () => ++at, second: () => at + 1, third: () => at + 2, fourth: () => at + 3, fifth: () => at + 4, sixth: () => at + 5, seventh: () => at + 6, eighth: () => at + 7, ninth: () => at + 8, tenth: () => at + 9, eleventh: () => at + 10, twelfth: () => at + 11 }; }
const dial = makeDial(10); print(dial.first(), dial.ninth(), dial.twelfth(), Object.keys(dial).join());
const other = makeDial(100); print(other.first(), other.first(), other.tenth(), dial.tenth());
