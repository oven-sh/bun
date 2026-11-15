// the closure made in front of the point sees the stores of the slow version, and the slow version sees the closure's
// whoever calls goes through a name that nobody knows at build time: the function is entered by value, at its own body, and is copied into no caller
const hiddenNames = JSON.parse('["f"]');
function through<T>(f: T): T { const box: any = { f }; return ((...list: any[]) => box[hiddenNames[0]](...list)) as any; }
class Tank { liters: number; constructor(liters: number) { this.liters = liters; } }
function fill(tank: Tank, by: number): string {
    let level = by;
    const raise = () => { level += 10; return level; };
    const first = raise();
    const liters = tank.liters;
    level += liters;
    const second = raise();
    return first + " " + liters + " " + second + " " + level;
}
const fillByValue = through(fill);
console.log(fillByValue(new Tank(1), 1), "|", fillByValue({ liters: 2 } as any, 1), "|", fillByValue({ get liters() { return 0.5; } } as any, -10));
