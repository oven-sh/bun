enum Shade { Dim = 1, Warm = 2, Bright = 4 }
class Lamp { shade: Shade = Shade.Bright; }
function glows(lamp: Lamp): boolean { const yes = (lamp.shade & 4) !== 0; lamp.shade |= 2; return yes; }
const lamp = new Lamp(); (globalThis as any).shelf = lamp;
const key: string = JSON.parse('"shade"');
const n = +(process.argv[2] ?? "1000"); let seen = 0;
for (let turn = 0; turn < n; turn++) { (lamp as any)[key] = "4"; if (glows(lamp)) seen++; }
console.log(seen);
