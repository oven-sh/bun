// Made by test/aot/tools/generate-calls-through-the-method-table-while-classes-are-defined.py.
const said: string[] = [];
const unseen = (0, eval);
interface Base { kind: number; pos: number; who(): string; more(): string }
interface Num extends Base { kind: 1; value: number }
interface Str extends Base { kind: 2; text: string }
class NodeObject {
  declare kind: number;
  declare pos: number;
  constructor(kind: number, pos: number) { this.kind = kind; this.pos = pos; }
  who(): string { return "node " + this.kind; }
  more(): string { return "more " + this.pos; }
}
class TokenObject extends NodeObject {
  who(): string { return "token " + this.kind; }
}
function num(value: number): Num { const made = new NodeObject(1, 0) as unknown as Num; made.value = value; return made; }
function str(text: string): Str { const made = new NodeObject(2, 0) as unknown as Str; made.text = text; return made; }
function tell(n: Base): string { return n.who() + " " + n.more(); }
function tellAll(): void {
  try {
    said.push(tell(num(1)) + " | " + tell(str("s")) + " | " + tell(new TokenObject(3, 1) as Base) + " | " + tell(kept));
  } catch (error: any) {
    said.push("thrown: " + error.name);
  }
}
const kept: Base = num(5);
tellAll();
Object.setPrototypeOf(NodeObject.prototype, { extra() { return 1; } });
tellAll();
console.log(said.join("\n"));
export {};
