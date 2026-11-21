// JSON.parse() as a type that reaches a type with a required method: the parser makes no such objects, so the class that implements it is all that its readers meet. Data that lies, data that is patched later, and methods that are optional.
interface Stone { grain: number; depth: number; under?: Stone; said(): string }
interface Named { name: string; greet?(): string }
interface Options { width: number; deep?: boolean; corner?: Stone; named?: Named; list?: Stone[] }
interface Order { turn: number; deed: string; terms?: any }
interface DigOrder extends Order { terms: { field: string; options: Options } }
class RoughStone implements Stone {
  under?: Stone; private text: string; depth: number; grain: number;
  constructor(grain: number, depth: number, text: string) { this.under = undefined; this.text = text; this.depth = depth; this.grain = grain; }
  said(): string { return this.text; }
}
class CutStone extends RoughStone { cut: string; constructor(depth: number, text: string) { super(12, depth, text); this.cut = "_" + text; } }
function parseMessage(text: string): Order { return JSON.parse(text) as Order; }
function parseOptions(text: string): Options { return JSON.parse(text); }
function parseStone(text: string): Stone { return JSON.parse(text) as Stone; }
function describe(stone: Stone): string { let s = stone.grain + "@" + stone.depth; if (stone.under) s += "<" + stone.under.grain; try { s += stone.said(); } catch (e: any) { s += e.name; } return s; }
function dig(order: DigOrder): string { const { field, options } = order.terms; return field + options.width + (options.deep ? "!" : "") + (options.corner ? describe(options.corner) : "-") + (options.named ? options.named.name + (options.named.greet ? options.named.greet() : "?") : "") + (options.list ?? []).map(describe).join(); }
Object.assign(globalThis, { parseMessage, parseOptions, parseStone, describe, dig });
const g: any = globalThis; let log = "";
const stones: Stone[] = []; for (let i = 0; i < 50; i++) { const n = i % 3 ? new RoughStone(i, i * 2, "t" + i) : new CutStone(i, "id" + i); if (i > 4) n.under = stones[i - 3]; stones.push(n); }
let sum = 0; for (const n of stones) for (const ch of g.describe(n)) sum = (sum * 31 + ch.charCodeAt(0)) % 1000003;
log += sum + " ";
const messages = [
  '{"turn":1,"deed":"dig","terms":{"field":"a.ts","options":{"width":9}}}',
  '{"turn":2,"deed":"dig","terms":{"field":"b.ts","options":{"width":1,"deep":true,"named":{"name":"n"}}}}',
  '{"turn":3,"deed":"dig","terms":{"field":"c.ts","options":{"width":2,"corner":{"grain":5,"depth":7,"under":{"grain":6,"depth":1}}}}}',
  '{"turn":4,"deed":"dig","terms":{"field":"d.ts","options":{"width":"x","list":[{"grain":1,"depth":2},{"depth":3,"grain":4,"said":"no"},null]}}}',
  '{"terms":{"options":{"corner":[1]},"field":null},"deed":7}'
];
for (const m of messages) { const order = g.parseMessage(m); try { log += order.turn + " " + g.dig(order) + " "; } catch (e: any) { log += e.name + " "; } }
const options = g.parseOptions('{"width":3,"corner":{"depth":1,"grain":2}}'); options.corner.said = function () { return "late" + this.grain; }; log += g.describe(options.corner) + " ";
options.corner = stones[6]; options.corner.grain = 99; log += g.describe(options.corner) + " " + JSON.stringify(options) + " ";
const parsed = g.parseStone('{"grain":11,"depth":12,"extra":1}'); log += g.describe(parsed) + " "; parsed.said = () => "patched"; log += g.describe(parsed) + " " + Object.keys(parsed) + " ";
stones.push(parsed, options.corner); for (const n of stones) sum = (sum * 7 + n.grain + n.depth) % 1000003;
console.log(log, sum);
