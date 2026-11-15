// An exception leaves two loops that push; the list is read behind it
function guarded(at) {
  const out = [];
  try {
    for (let i = 0; i < 4; i++) {
      for (let k = 0; k < i; k++) out.push(i * k);
      out.push("row");
      if (i === at) throw out.length;
    }
  } catch (size) {
    out.push(size);
  }
  return out.join() + " " + out.length;
}
console.log(guarded(2));
console.log(guarded(0));
console.log(guarded(3), guarded(-1));
