// being left changes nothing for the next call: fitting and misfitting values come in turns, a thousand times
// whoever calls goes through a name that nobody knows at build time: the function is entered by value, at its own body, and is copied into no caller
const hiddenNames = JSON.parse('["f"]');
function through<T>(f: T): T { const box: any = { f }; return ((...list: any[]) => box[hiddenNames[0]](...list)) as any; }
class Tick { at: number; constructor(at: number) { this.at = at; } }
let effects = 0;
function stamp(tick: Tick, base: number): number { effects++; const doubled = base * 2; return tick.at + doubled; }
const stampByValue = through(stamp);
let sum = 0;
for (let i = 0; i < 1000; i++) sum += stampByValue(i % 3 ? new Tick(i) : ({ at: -i } as any), i);
console.log(sum, effects);
