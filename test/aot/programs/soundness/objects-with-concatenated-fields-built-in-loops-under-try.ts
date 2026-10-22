interface Link {
  label: string;
  next: Link | null;
}
function createLink(id: number, next: Link | null): Link {
  return { label: "link" + id, next };
}
function build(): Link | null {
  let head: Link | null = null;
  for (let start = 0; start < 4; start += 2) {
    try {
      for (let i = start; i < start + 2; i++) head = createLink(i, head);
    } catch {}
  }
  return head;
}
let count = 0;
for (let link = build(); link !== null; link = link.next) count += link.label.length;
console.log(count);
