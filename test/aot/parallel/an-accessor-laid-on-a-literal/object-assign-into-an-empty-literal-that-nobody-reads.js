// The empty literal has the layout of the record that is copied into it, and nobody reads the copy by a name.
const seen = []; const holder = { get a() { seen.push("g"); return 7; }, b: 2 };
const copy = Object.assign({}, holder); console.log(typeof copy, seen.join());
