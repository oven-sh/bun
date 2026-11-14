// JSON.parse() as a type that reaches a type with a required method: the parser makes no such objects, so the class that implements it is all that its readers meet. Data that lies, data that is patched later, and methods that are optional.
interface Node1 { kind: number; pos: number; parent?: Node1; getText(): string }
interface Named { name: string; greet?(): string }
interface Options { target: number; strict?: boolean; configFile?: Node1; named?: Named; list?: Node1[] }
interface Request1 { seq: number; command: string; arguments?: any }
interface OpenRequest extends Request1 { arguments: { file: string; options: Options } }
class NodeObject implements Node1 {
  kind: number; pos: number; parent?: Node1; private text: string;
  constructor(kind: number, pos: number, text: string) { this.kind = kind; this.pos = pos; this.text = text; this.parent = undefined; }
  getText(): string { return this.text; }
}
class IdentifierObject extends NodeObject { escaped: string; constructor(pos: number, text: string) { super(80, pos, text); this.escaped = "_" + text; } }
function parseMessage(text: string): Request1 { return JSON.parse(text) as Request1; }
function parseOptions(text: string): Options { return JSON.parse(text); }
function parseNode(text: string): Node1 { return JSON.parse(text) as Node1; }
function describe(node: Node1): string { let s = node.kind + "@" + node.pos; if (node.parent) s += "<" + node.parent.kind; try { s += node.getText(); } catch (e: any) { s += e.name; } return s; }
function open(request: OpenRequest): string { const { file, options } = request.arguments; return file + options.target + (options.strict ? "!" : "") + (options.configFile ? describe(options.configFile) : "-") + (options.named ? options.named.name + (options.named.greet ? options.named.greet() : "?") : "") + (options.list ?? []).map(describe).join(); }
Object.assign(globalThis, { parseMessage, parseOptions, parseNode, describe, open });
const g: any = globalThis; let log = "";
const nodes: Node1[] = []; for (let i = 0; i < 50; i++) { const n = i % 3 ? new NodeObject(i, i * 2, "t" + i) : new IdentifierObject(i, "id" + i); if (i > 4) n.parent = nodes[i - 3]; nodes.push(n); }
let sum = 0; for (const n of nodes) for (const ch of g.describe(n)) sum = (sum * 31 + ch.charCodeAt(0)) % 1000003;
log += sum + " ";
const messages = [
  '{"seq":1,"command":"open","arguments":{"file":"a.ts","options":{"target":9}}}',
  '{"seq":2,"command":"open","arguments":{"file":"b.ts","options":{"target":1,"strict":true,"named":{"name":"n"}}}}',
  '{"seq":3,"command":"open","arguments":{"file":"c.ts","options":{"target":2,"configFile":{"kind":5,"pos":7,"parent":{"kind":6,"pos":1}}}}}',
  '{"seq":4,"command":"open","arguments":{"file":"d.ts","options":{"target":"x","list":[{"kind":1,"pos":2},{"pos":3,"kind":4,"getText":"no"},null]}}}',
  '{"arguments":{"options":{"configFile":[1]},"file":null},"command":7}'
];
for (const m of messages) { const request = g.parseMessage(m); try { log += request.seq + " " + g.open(request) + " "; } catch (e: any) { log += e.name + " "; } }
const options = g.parseOptions('{"target":3,"configFile":{"pos":1,"kind":2}}'); options.configFile.getText = function () { return "late" + this.kind; }; log += g.describe(options.configFile) + " ";
options.configFile = nodes[6]; options.configFile.kind = 99; log += g.describe(options.configFile) + " " + JSON.stringify(options) + " ";
const parsed = g.parseNode('{"kind":11,"pos":12,"extra":1}'); log += g.describe(parsed) + " "; parsed.getText = () => "patched"; log += g.describe(parsed) + " " + Object.keys(parsed) + " ";
nodes.push(parsed, options.configFile); for (const n of nodes) sum = (sum * 7 + n.kind + n.pos) % 1000003;
console.log(log, sum);
