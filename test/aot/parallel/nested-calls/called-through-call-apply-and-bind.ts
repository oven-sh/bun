function outer(base: number) {
  let seen = "";
  note.call(undefined, 1);
  note.apply(undefined, [2]);
  note.bind(undefined, 3)();
  note(4);
  return seen + base;
  function note(this: unknown, x: number) { seen += x + (this === undefined ? "u" : "o") + ","; }
}
console.log(outer(7));
