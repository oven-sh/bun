enum Shade { Dim = 1, Warm = 2, Bright = 4 }
const tint = Symbol("tint");
class Lamp {
    shade: Shade = Shade.Bright;
    [tint]: Shade = Shade.Dim;
    watts: number = 40;
    label: string = "desk";
    lit: boolean = false;
}
const lines: string[] = [];
function say(what: string, value: unknown) { lines.push(what + ": " + (typeof value === "symbol" ? String(value) : typeof value + " " + JSON.stringify(value))); }
function picture(lamp: Lamp): string {
    const own = Reflect.ownKeys(lamp).map(String).join(",");
    const listed: string[] = [];
    for (const key in lamp) listed.push(key);
    return own + " | " + listed.join(",") + " | " + JSON.stringify(lamp) + " | " + String((lamp as any)[tint]);
}
function glows(lamp: Lamp): boolean { const yes = (lamp.shade & 4) !== 0; lamp.shade |= 2; return yes; }
function tinted(lamp: Lamp): boolean { const yes = (lamp[tint] & 4) !== 0; lamp[tint] |= 2; return yes; }
const nameOfShade: string = JSON.parse('"shade"');
const nameOfWatts: string = JSON.parse('"watts"');
const nameOfLabel: string = JSON.parse('"label"');
const nameOfLit: string = JSON.parse('"lit"');
const turns = 400;

{
    const lamp = new Lamp(); (globalThis as any).shelf = lamp;
    const key = Object.getOwnPropertySymbols(lamp)[0]!;
    let seen = 0;
    for (let turn = 0; turn < turns; turn++) {
        (lamp as any)[nameOfShade] = "4"; (lamp as any)[key] = "5";
        if (turn % 97 === 0) say("both out, turn " + turn, picture(lamp));
        if (glows(lamp)) seen++;
        if (tinted(lamp)) seen++;
        if (turn % 97 === 0) say("both back, turn " + turn, picture(lamp));
    }
    say("seen", seen);
}
{
    const lamp = new Lamp(); (globalThis as any).shelf = lamp;
    for (let turn = 0; turn < turns; turn++) {
        (lamp as any)[nameOfShade] = "4"; (lamp as any)[nameOfWatts] = "sixty";
        lamp.shade = Shade.Warm;
        if (turn % 131 === 0) say("the first that left is back, turn " + turn, picture(lamp));
        lamp.watts = turn;
        if (turn % 131 === 0) say("and the second, turn " + turn, picture(lamp));
        (lamp as any)[nameOfWatts] = "sixty"; (lamp as any)[nameOfShade] = "4";
        lamp.shade = Shade.Dim; lamp.watts = turn + 0.5;
        if (turn % 131 === 0) say("the last that left is back first, turn " + turn, picture(lamp));
    }
}
{
    const lamp = new Lamp(); (globalThis as any).shelf = lamp;
    for (let turn = 0; turn < turns; turn++) {
        (lamp as any)[nameOfShade] = "4";
        (lamp as any).added = turn;
        lamp.shade = Shade.Bright;
        if (turn % 131 === 0) say("a property was added while it was out, turn " + turn, picture(lamp));
        if (turn % 3 === 0) delete (lamp as any).added;
        if (turn % 131 === 0) say("and deleted, turn " + turn, picture(lamp));
    }
}
{
    const lamp = new Lamp(); (globalThis as any).shelf = lamp;
    (lamp as any).before = "here"; (lamp as any).alsoBefore = 1;
    for (let turn = 0; turn < turns; turn++) {
        (lamp as any)[nameOfLabel] = turn; (lamp as any)[nameOfLit] = "yes";
        if (turn % 131 === 0) say("beside two properties, out, turn " + turn, picture(lamp));
        lamp.lit = turn % 2 === 0; lamp.label = "t" + turn;
        if (turn % 131 === 0) say("beside two properties, back, turn " + turn, picture(lamp));
    }
}
{
    const lamps = [new Lamp(), new Lamp(), new Lamp()]; (globalThis as any).shelf = lamps;
    let seen = 0;
    for (let turn = 0; turn < turns; turn++) {
        const lamp = lamps[turn % 3]!, other = lamps[(turn + 1) % 3]!;
        (lamp as any)[nameOfShade] = "4";
        if (glows(other)) seen++;
        if (glows(lamp)) seen++;
        if (turn === 200) Bun.gc(true);
    }
    say("three lamps", seen); for (const lamp of lamps) say("lamp", picture(lamp));
}
{
    const lamp = new Lamp(); (globalThis as any).shelf = lamp;
    for (let turn = 0; turn < 40; turn++) { (lamp as any)[nameOfShade] = "4"; glows(lamp); if (turn % 8 === 0) Bun.gc(true); }
    say("an old lamp", picture(lamp));
    (lamp as any)[nameOfShade] = "4";
    Object.defineProperty(lamp, "shade", { writable: false });
    try { lamp.shade = Shade.Dim; say("stored", lamp.shade); } catch (error) { say("refused", (error as Error).constructor.name); }
    say("read only while out", Object.getOwnPropertyDescriptor(lamp, "shade"));
    Object.defineProperty(lamp, "shade", { writable: true, value: Shade.Warm });
    say("writable again", Object.getOwnPropertyDescriptor(lamp, "shade")); say("glows", glows(lamp)); say("after", picture(lamp));
}
{
    const lamp = new Lamp(); (globalThis as any).shelf = lamp;
    for (let turn = 0; turn < 10; turn++) { (lamp as any)[nameOfShade] = "4"; glows(lamp); }
    (lamp as any)[nameOfShade] = "4";
    Object.freeze(lamp);
    try { lamp.shade = Shade.Dim; say("stored", lamp.shade); } catch (error) { say("refused", (error as Error).constructor.name); }
    say("frozen while out", picture(lamp));
}
{
    const lamp = new Lamp(); (globalThis as any).shelf = lamp;
    let calls = 0;
    for (let turn = 0; turn < 10; turn++) { (lamp as any)[nameOfShade] = "4"; glows(lamp); }
    (lamp as any)[nameOfShade] = "4";
    Object.defineProperty(lamp, "shade", { get() { calls++; return Shade.Bright; }, set(_value) { calls += 10; }, configurable: true, enumerable: true });
    say("an accessor in its place", glows(lamp)); say("calls", calls);
    Object.defineProperty(lamp, "shade", { value: Shade.Dim, writable: true, configurable: true, enumerable: true });
    say("a value again", glows(lamp)); say("after", picture(lamp));
}
{
    const lamp = new Lamp(); (globalThis as any).shelf = lamp;
    for (let turn = 0; turn < turns; turn++) {
        (lamp as any)[nameOfShade] = "4";
        delete (lamp as any)[nameOfShade];
        if (turn % 131 === 0) say("deleted while out, turn " + turn, picture(lamp));
        lamp.shade = Shade.Warm;
        if (turn % 131 === 0) say("made again, turn " + turn, picture(lamp));
    }
}
{
    const parent = new Lamp(); (globalThis as any).shelf = parent;
    const child = Object.create(parent) as Lamp;
    let seen = 0;
    for (let turn = 0; turn < turns; turn++) {
        (parent as any)[nameOfShade] = "4";
        if (((child as any).shade & 4) !== 0) seen++;
        parent.shade = Shade.Warm;
        if (((child as any).shade & 4) !== 0) seen++;
    }
    say("read through a child", seen); say("parent", picture(parent));
}
console.log(lines.join("\n"));
