class Node {
  next: Node | null = null;
  back?: Node;
  other: Node | undefined;
  constructor(public value: number) {}
  twice(): number { return this.value * 2; }
}
class Holder { kept: Node | null | undefined = null; list: (Node | null)[] = []; static last: Node | undefined; }
const holder = new Holder();
function chain(length: number): Node | null {
  let head: Node | null = null;
  for (let i = 0; i < length; i++) {
    const node = new Node(i);
    node.next = head;
    if (head) head.back = node;
    if (i % 3 === 0) node.other = head ?? node;
    head = node;
  }
  return head;
}
function forward(node: Node | null): number { let sum = 0; for (let at = node; at; at = at.next) sum += at.value; return sum; }
function backward(node: Node | undefined): number { let sum = 0; while (node !== undefined) { sum = sum * 2 + node.value; node = node.back; } return sum % 1000003; }
function around(node: Node | null): number { let sum = 0; for (let at = node, turns = 0; at && turns < 40; turns++) { sum += at.twice(); at = at.other ?? at.next; } return sum; }
function pick(node: Node | null, i: number): Node | null | undefined { switch (i & 3) { case 0: return node; case 1: return null; case 2: return undefined; default: return node && node.next; } }
function turn(i: number): string {
  const head = chain(i % 7);
  holder.kept = pick(head, i);
  holder.list[i % 5] = i & 1 ? head : null;
  Holder.last = i % 4 ? head ?? undefined : undefined;
  let text = forward(head) + "," + backward(head?.next ?? undefined) + "," + around(head);
  text += "," + (holder.kept === null) + (holder.kept === undefined) + (holder.kept == null) + (holder.kept === head);
  text += "," + (holder.kept?.value ?? "none") + "," + (Holder.last ? Holder.last.twice() : "nobody");
  for (const node of holder.list) text += node ? node.value : "-";
  try { text += holder.kept!.twice(); } catch (error) { text += (error as Error).constructor.name; }
  try { text += (holder.kept as Node).next!.value; } catch (error) { text += (error as Error).constructor.name; }
  return text;
}
let all = "";
for (let i = 0; i < 60; i++) all += turn(i) + "\n";
console.log(all);
