// The type lists two texts. A cast, a store by key and JSON bring a third, a string that only looks like a listed one, and what is no string.
// Under: --aot-testing=CheckProofsAtRunTime: the written type of a field that lists texts
type Color = "red" | "green";
class Light { color: Color = "red"; }
function isRed(light: Light) { return light.color === "red"; }
function show(light: Light) { return typeof light.color + ":" + String(light.color) + ":" + isRed(light); }
const lines: string[] = [];
const light = new Light();
lines.push(show(light));
light.color = "blue" as string as Color;
lines.push(show(light));
(light as any)["col" + JSON.parse('"or"')] = "re" + JSON.parse('"d"');
lines.push(show(light));
(light as any).color = 7;
lines.push(show(light));
Object.assign(light, JSON.parse('{"color":"green"}'));
lines.push(show(light));
Object.assign(light, JSON.parse('{"color":null}'));
lines.push(show(light));
Object.defineProperty(light, "color", { get() { return "red"; }, configurable: true });
lines.push(show(light));
delete (light as any).color;
lines.push(show(light));
console.log(lines.join("\n"));
