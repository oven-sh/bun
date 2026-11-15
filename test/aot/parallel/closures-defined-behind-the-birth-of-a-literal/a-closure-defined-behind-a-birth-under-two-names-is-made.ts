const print = console.log;
interface Dial { first(): number; second(): number; third(): number; fourth(): number; fifth(): number; sixth(): number; seventh(): number; eighth(): number; ninth(): number; tenth(): number; eleventh(): number; twelfth(): number; again(): number; }
function makeDial(start: number): Dial { let at = start; function step(): number { return ++at; } return { first: () => at + 0, second: () => at + 1, third: () => at + 2, fourth: () => at + 3, fifth: () => at + 4, sixth: () => at + 5, seventh: () => at + 6, eighth: () => at + 7, ninth: () => at + 8, tenth: () => at + 9, eleventh: step, twelfth: () => at + 11, again: step }; }
const dial = makeDial(10); print(dial.eleventh(), dial.again(), dial.eleventh === dial.again, dial.twelfth(), Object.keys(dial).join());
const other = makeDial(100); print(other.again(), other.eleventh(), other.first(), dial.first(), other.again === dial.again);
