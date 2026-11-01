// The annotation names a class, and the function arrives.
function K() {}
K.n = 1;
class Box {
  n = 2;
}
function read(box: Box) {
  return box.n;
}
function write(box: Box) {
  box.n = 9;
}
console.log(read(new Box()), read(K as any));
write(K as any);
console.log(K.n);
