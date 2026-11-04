// which way was taken decides what the names hold where the read fails
// whoever calls goes through a name that nobody knows at build time: the function is entered by value, at its own body, and is copied into no caller
const hiddenNames = JSON.parse('["f"]');
function through<T>(f: T): T { const box: any = { f }; return ((...list: any[]) => box[hiddenNames[0]](...list)) as any; }
class Knob { level: number; constructor(level: number) { this.level = level; } }
function turn(way: number, knob: Knob): string {
    let amount: number;
    let label: string | undefined;
    let pair: number[];
    if (way > 0) { amount = way * 2; label = "up"; pair = [way]; } else if (way < 0) { amount = way / 2; label = undefined; pair = [way, way]; } else { amount = 0.5; label = "still"; pair = []; }
    const level = knob.level;
    pair.push(level);
    return amount + " " + label + " " + pair.join("/") + " " + (way ? level + amount : level);
}
const turnByValue = through(turn);
for (const knob of [new Knob(1), { level: 2 }] as any[]) console.log(turnByValue(3, knob), "|", turnByValue(-3, knob), "|", turnByValue(0, knob));
