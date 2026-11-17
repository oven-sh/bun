// A field of the first link becomes a getter in a function that the outer loop calls.
interface Link {
  v: string;
  w: string;
  next: Link | null;
}
const out: string[] = [];
function walk(head: Link, change: (x: any, r: number) => void): void {
  for (let r = 0; r < 4; r++) {
    const all: string[] = [];
    let n: Link | null = head;
    while (n !== null) {
      if (n.v) all.push(n.w);
      else all.push(n.v);
      n = n.next;
    }
    out.push(all.join());
    change(head, r);
  }
}
function link(v: string, w: string, next: Link | null): Link {
  return { v, w, next };
}
const list: any = JSON.parse("0", () => link("a", "b", link("", "d", null)));
walk(list, (x, r) => {
  if (r === 0)
    Object.defineProperty(x, "w", {
      get() {
        return "got";
      },
      configurable: true,
    });
  if (r === 2) Object.defineProperty(x, "w", { value: "value again", writable: false });
});
console.log(out.join(" "));
