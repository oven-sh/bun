// cycles: a node that holds itself, a ring of three, a ring through a list, a ring whose every node carries a long text. Each throws the TypeError of the host, and the next text is whole
// COUNT: operation:operationAOTStringBuilderBegin >= 1
type Node = { v: number; a: string; b: string; c: string; d: string; next?: Node; list?: Node[] };
function write(node: Node): string {
  return JSON.stringify(node);
}
function make(v: number, text = "a"): Node {
  return { v, a: text, b: "b", c: "c", d: "d" };
}
function tell(node: Node) {
  try {
    console.log(write(node).length);
  } catch (e) {
    console.log((e as Error).name + ": " + (e as Error).message.split("\n")[0]);
  }
}
const chain = make(1);
chain.next = make(2);
chain.next.next = make(3);
tell(chain);
const self = make(4);
self.next = self;
tell(self);
chain.next.next.next = chain;
tell(chain);
const throughList = make(5);
throughList.list = [make(6), throughList];
tell(throughList);
const heavy = make(7, "x".repeat(300000));
heavy.next = make(8, "y".repeat(300000));
heavy.next.next = heavy;
tell(heavy);
for (let i = 0; i < 3; i++) tell(i === 1 ? self : make(i));
console.log(write(make(9)));
