// The functions of an evaluated script are made before its statements, whether the script names them or not. A function that another function declares is made when it is first read.
globalThis.run = read => console.log(read());

(0, eval)(
  "const shared = {}; function kind() { return typeof shared; } run(kind); function unused() { function inner() { return 1; } run(inner); }",
);
(0, eval)(
  "const list = [1, 2]; function total() { return list.length; } function twice() { function add() { return total() + total(); } run(add); } run(total); twice();",
);
(0, eval)(
  "let count = 1; const step = 2; function next() { return (count += step); } function both() { function again() { return next() + step; } run(again); } run(next); both(); run(next);",
);
(0, eval)(
  "try { early(); } catch (error) { run(() => error.name); } const late = 'late'; function early() { return late; } run(early); function holder() { function held() { return late; } run(held); } holder();",
);
