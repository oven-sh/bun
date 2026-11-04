// the read stands in the condition: the point lies in front of the branch, and either side may be taken behind it
// whoever calls goes through a name that nobody knows at build time: the function is entered by value, at its own body, and is copied into no caller
const hiddenNames = JSON.parse('["f"]');
function through<T>(f: T): T { const box: any = { f }; return ((...list: any[]) => box[hiddenNames[0]](...list)) as any; }
class Lamp { on: boolean; watts: number; constructor(on: boolean, watts: number) { this.on = on; this.watts = watts; } }
const log: string[] = [];
function draw(lamp: Lamp, hours: number): number {
    log.push("draw");
    const base = hours * 10;
    if (lamp.on) { log.push("on"); return base + lamp.watts; }
    log.push("off");
    return lamp.watts > 50 ? base - 1 : -base;
}
function pick(lamp: Lamp, a: string, b: string): string { return (lamp.on ? a : b) + (lamp.watts > 10 && lamp.on ? "!" : "?"); }
const drawByValue = through(draw);
const pickByValue = through(pick);
for (const lamp of [new Lamp(true, 60), new Lamp(false, 60), { on: true, watts: 5 }, { on: 0, watts: 70 }, { on: "yes", watts: 20 }, { watts: 1 }] as any[]) console.log(drawByValue(lamp, 2), pickByValue(lamp, "a", "b"));
console.log(log.join());
