// an object that is one of two literals holds another object while the collector runs between the branch and the read
type Holder = { inner: { text: string } };
function subject(c: unknown, n: number) { const p: Holder = c ? { inner: { text: "left" + n } } : { inner: { text: "right" + n } }; Bun.gc(true); return p.inner.text; }
function deed(c: unknown, n: number) { return subject(c, n); }
console.log(deed(true, 1), deed(false, 1));
let text = "";
for (let i = 0; i < 20; i++) text += deed(i % 2, i) + " ";
console.log(text);
console.log(deed(JSON.parse("0"), 2));
