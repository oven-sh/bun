// A field that is written as `"red" | "green"` may hold a word. Whoever reads it from outside gets the string.
// Under: --aot-testing=CheckProofsAtRunTime: the written type of a field that lists texts
type Color = "red" | "green" | "";
class Light { color: Color; constructor(color: Color) { this.color = color; } flip() { this.color = this.color === "red" ? "green" : "red"; return this; } }
const lights = [new Light("red"), new Light("green"), new Light("")];
const lines: string[] = [];
lines.push(JSON.stringify(lights));
lines.push(lights.map(light => light.flip().color).join());
lines.push(Object.values(lights[0]).join(), Object.entries(lights[1]).join(), String(Reflect.get(lights[2], "color")));
lines.push(lights.map(light => light.color.length + light.color.toUpperCase() + light.color.charCodeAt(0) + typeof light.color).join());
const counts = new Map<string, number>();
for (const light of lights) counts.set(light.color, (counts.get(light.color) ?? 0) + 1);
lines.push([...counts].join(";"), String(counts.get("re" + JSON.parse('"d"'))), String(new Set<string>(lights.map(light => light.color)).has("gre" + JSON.parse('"en"'))));
const copy = { ...lights[0] };
lines.push(copy.color, String(copy.color === lights[0].color), `${lights[0].color}-${lights[1].color}`);
console.log(lines.join("\n"));
