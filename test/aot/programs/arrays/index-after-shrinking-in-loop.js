// The body of a loop shortens the array that the loop iterates and indexes. That an index was below the length says nothing about a later read: past the new end a read gives undefined, a store makes the array longer again, and the loop ends where plain Bun ends it.
const show = list => list.map(String).join();
function lengthSetInBody(a) { const out = []; for (let i = 0; i < a.length; i++) { if (i === 1) a.length = 2; out.push(a[i], a[i + 1]); } return show(out); }
function boundReadOnce(a) { const out = []; for (let i = 0, n = a.length; i < n; i++) { if (i === 1) a.length = 1; out.push(a[i]); } return show(out); }
function testedThenShortened(a) { const out = []; for (let i = 0; i < a.length; i++) { if (i < a.length) { a.length = i; out.push(a[i]); } } return show(out); }
function popsInBody(a) { const out = []; for (let i = 0; i < a.length; i++) { a.pop(); out.push(a[i], a.length); } return show(out); }
function shiftsInBody(a) { const out = []; for (let i = 0; i < a.length; i++) { a.shift(); out.push(a[i], a[a.length]); } return show(out); }
function splicesInBody(a) { const out = []; for (let i = 0; i < a.length; i++) { a.splice(i, 2); out.push(a[i], a[i + 1]); } return show(out); }
function shortenedByCall(a, shorten) { const out = []; for (let i = 0; i < a.length; i++) { shorten(a); out.push(a[i]); } return show(out); }
function forOfPops(a) { const out = []; for (const x of a) { a.pop(); out.push(x, a[a.length]); } return show(out); }
function entriesShortened(a) { const out = []; for (const [i, x] of a.entries()) { if (a.length > 2) a.length = 2; out.push(i, x, a[i + 1]); } return show(out); }
function otherArrayShortened(a, b) { const out = []; for (let i = 0; i < a.length; i++) { out.push(a[i]); b.length = 1; out.push(b[i]); } return show(out); }
function storesAfterShortening(a) { const out = []; for (let i = 0, n = a.length; i < n && i < 4; i++) { a.length = 1; a[i] = a[0]; out.push(a.length, a[i]); } return show(out); }
function emptiedAndRefilled(a) { const out = []; for (let i = 0; i < a.length && out.length < 8; i++) { const last = a[a.length - 1]; a.length = 0; a.push(last, last); out.push(a[i], a[i + 1]); } return show(out); }
function viewOfResizedBuffer() { const buffer = new ArrayBuffer(8, { maxByteLength: 8 }), view = new Uint8Array(buffer).fill(7), out = []; for (let i = 0; i < view.length; i++) { if (i === 2) buffer.resize(3); out.push(view[i], view[i + 1]); } return show(out); }
const kinds = [["integers", () => [1, 2, 3, 4, 5]], ["doubles", () => [1.5, 2.5, 3.5, 4.5, 5.5]], ["strings", () => ["a", "b", "c", "d", "e"]], ["holes", () => [1, , 3, , 5]], ["mixed", () => [1, "b", 3.5, null, true]]];
for (const [kind, make] of kinds) {
  let previous = "";
  for (let round = 0; round < 100; round++) {
    const output = [lengthSetInBody(make()), boundReadOnce(make()), testedThenShortened(make()), popsInBody(make()), shiftsInBody(make()), splicesInBody(make()), shortenedByCall(make(), a => { a.length = Math.max(0, a.length - 2); }), shortenedByCall(make(), a => a.pop()), forOfPops(make()), entriesShortened(make()), otherArrayShortened(make(), make()), storesAfterShortening(make()), emptiedAndRefilled(make())].join(" | ");
    if (output !== previous) console.log(kind + ": " + output);
    previous = output;
  }
}
console.log("view: " + viewOfResizedBuffer());
