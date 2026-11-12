function Made(n) {
  this.x = n;
  if (n > 2) return true;
  return false;
}
function work(n) {
  if (new Made(n)) return "object";
  return "boolean";
}
let objects = 0;
for (let n = 0; n < 6; n++) {
  if (new Made(n)) objects++;
  console.log(work(n), objects);
}
