// A for-of written for ES5 reads `it.return` in a finally. An array iterator has no such member unless the program gives it one.
function closes(it, step) {
  let closed = "open";
  try {
    return it.next().value;
  } finally {
    let close;
    if (step && !step.done && (close = it.return)) closed = close.call(it);
    log.push(String(closed));
  }
}
const log = [];
for (let i = 0; i < 3000; i++) closes([i, 2].values(), { done: false });
console.log(log.at(-1));

function reads(give) {
  const it = [1, 2].values();
  if (give) it.return = () => "own";
  let close;
  try {
    it.next();
  } finally {
    close = it.return;
  }
  return close ? close() : "none";
}
let out = "";
for (let i = 0; i < 3000; i++) out = reads(i % 2 === 1) + reads(false);
console.log(out);
