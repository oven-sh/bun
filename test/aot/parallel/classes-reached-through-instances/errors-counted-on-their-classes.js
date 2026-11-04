function note(e) {
  e.constructor.seen = (e.constructor.seen ?? 0) + 1;
}
try {
  null.x;
} catch (e) {
  note(e);
}
try {
  undefined.y;
} catch (e) {
  note(e);
}
try {
  missing;
} catch (e) {
  note(e);
}
try {
  new Array(-1);
} catch (e) {
  note(e);
}
try {
  decodeURIComponent("%");
} catch (e) {
  note(e);
}
function report() {
  return [TypeError.seen, ReferenceError.seen, RangeError.seen, URIError.seen].join();
}
console.log(report());
