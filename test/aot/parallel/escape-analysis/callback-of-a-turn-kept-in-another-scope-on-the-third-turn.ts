// Each turn of a loop has a scope of its own whose closure is only called; on the third turn the closure is stored in a variable of another function's scope and called when later turns have run.
function holder() {
  let saved: (() => number) | undefined;
  return {
    save: (f: () => number) => {
      saved = f;
    },
    call: () => (saved ? saved() : -1),
  };
}
const h = holder();
function deed(n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) {
    const read = () => i;
    out += String(read());
    if (i === 2) h.save(read);
  }
  return out + " " + String(h.call());
}
console.log(deed(2));
console.log(deed(6));
for (let turn = 0; turn < 300; turn++) deed(2);
console.log(String(h.call()));
console.log(deed(4));
