// A parameter that is assigned to is another value from there on: what the guard has proven holds of what arrived.
class Node {
  value = 0;
  next: Node | null = null;
  constructor(value: number, next: Node | null) {
    this.value = value;
    this.next = next;
  }
}
const any = (value: unknown): any => value;
function last(node: Node): string {
  let steps = 0;
  while (node.next) {
    node = node.next;
    steps++;
  }
  return node.value + " after " + steps;
}
function widen(n: number): string {
  const first = n + 1;
  n = any("text");
  const second = n + 1;
  n = any(null);
  const third = n + 1;
  n = any({ valueOf: () => 40 });
  const fourth = n + 1;
  return first + "|" + second + "|" + third + "|" + fourth;
}
function swap(a: number, b: string): string {
  const before = a * 2 + b.length;
  const held: any = a;
  a = any(b);
  b = held;
  return before + "|" + a + "|" + b + "|" + typeof a + "|" + typeof b + "|" + (a + 1) + "|" + (b + 1);
}
function replace(box: { size: number }, other: unknown): string {
  const before = box.size;
  if (before > 1) box = any(other);
  return before + "|" + (box == null ? "none" : String(box.size));
}
function sloppyArguments(a: number, b: number) {
  const before = a + b;
  arguments[0] = "changed";
  return before + "|" + a + "|" + arguments.length + "|" + arguments[0];
}
function captured(n: number): string {
  const read = () => n;
  const first = n * 2;
  n = any("later");
  return first + "|" + read() + "|" + typeof n;
}
console.log(last(new Node(1, new Node(2, new Node(3, null)))));
console.log(last(new Node(1, any({ value: "plain", next: null }))));
console.log(last(new Node(1, any({ value: "plain", next: new Node(9, null) }))));
console.log(last(any({ value: "start", next: new Node(4, null) })));
console.log(widen(1), widen(any("1")), widen(any(undefined)));
console.log(swap(2, "ab"), swap(any("x"), any(3)), swap(2, "cd"));
console.log(replace({ size: 1 }, 5), replace({ size: 2 }, { size: "other" }), replace({ size: 3 }, null), replace({ size: 4 }, "text"), replace(any({ size: 5, more: 1 }), [1]));
console.log(sloppyArguments(1, 2), sloppyArguments(any("a"), 2), (sloppyArguments as any)(1), (sloppyArguments as any)(1, 2, 3));
console.log(captured(4), captured(any("four")), captured(5));
