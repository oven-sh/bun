// a chain of nodes a hundred, ten thousand and sixty thousand deep: the text, or the error of the host, and the next text is whole
// COUNT: operation:operationAOTStringBuilderBegin >= 1
type Node = { v: number; a: string; b: string; c: string; d: string; next?: Node };
function write(node: Node): string {
  return JSON.stringify(node);
}
function chain(depth: number): Node {
  let node: Node = { v: 0, a: "a", b: "b", c: "c", d: "d" };
  for (let i = 1; i <= depth; i++) node = { v: i, a: "a", b: "b", c: "c", d: "d", next: node };
  return node;
}
function tell(depth: number) {
  try {
    const text = write(chain(depth));
    console.log(depth, text.length, text.slice(0, 40), text.slice(-12));
  } catch (e) {
    console.log(depth, (e as Error).name);
  }
}
tell(100);
tell(10000);
tell(60000);
tell(3);
