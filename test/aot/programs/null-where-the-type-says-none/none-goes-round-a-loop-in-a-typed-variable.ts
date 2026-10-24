interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
interface Node { value: number; next: Node }
function chain(length: number): Node { let head: Node = undefined as any; for (let index = length; index > 0; index--) head = { value: index, next: head }; return head; }
function sum(head: Node): number { let total = 0; for (let node: Node = head; node; node = node.next) total += node.value; return total; }
function sumUntilNull(head: Node): number { let total = 0, node: Node = head; while (node != null) { total += node.value; node = node.next; } return total; }
function last(head: Node): number { let node = head; while (node.next !== undefined) node = node.next; return node.value; }
console.log(sum(chain(5)), sumUntilNull(chain(4)), last(chain(3)), sum(chain(0)), sumUntilNull(chain(0))); attempt("last of none", () => last(chain(0)));
