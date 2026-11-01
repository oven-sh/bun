TypeError.note = 7;
try {
  null.x;
} catch (e) {
  e.constructor.note = "text";
}
function read() {
  return TypeError.note.length;
}
console.log(read());
