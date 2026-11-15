const holder = { inner: { text: "hi" } };
function innerOf(h) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return h.inner; }
function textOf(h) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return innerOf(h).text; }
function withExtras(extra) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return { a: 1, ...extra }; }
function isText(v) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return typeof v === "string"; }
let seen = 0;
for (let turn = 0; turn < 300; turn++) {
    const bare = withExtras(undefined);
    const made = withExtras(textOf(holder));
    seen += bare.a + made.a + (isText(made[turn & 1]) ? 1 : 0);
}
console.log(seen);
