// Flags: --aot-validate
// Bun.file takes a view as its path, and the view is written and read around the call.
function viaLocal() {
  const view = new Uint8Array(8);
  view.fill(97);
  view[0] = 98;
  const file = Bun.file(view);
  view[1] = 99;
  view[2] = 100;
  return [view[0], view[1], view[2], new Uint8Array(view.buffer)[1], file.name].join();
}
function viaParameter(view) {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    view[i] = 65 + i;
    if (i === 1) Bun.file(view);
    sum += view[i];
  }
  return [sum, Array.from(view).join("-"), Array.from(new Uint8Array(view.buffer)).join("-")].join();
}
console.log(viaLocal());
console.log(viaParameter(new Uint8Array(6).fill(48)));
