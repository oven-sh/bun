function make(skip) {
  let at = 0;
  const api = { step: () => (at++, skip), flip: () => { skip = !skip; return skip; } };
  return api;
}
const made = make(true);
console.log(made.step(), made.flip(), made.step(), made.flip(), made.step());
