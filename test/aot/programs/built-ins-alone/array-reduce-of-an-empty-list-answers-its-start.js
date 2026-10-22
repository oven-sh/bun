const start = [].reduce(() => 0, "start");
console.log(typeof start, start.length);
try {
  [].reduce(() => 0);
} catch (error) {
  console.log(error instanceof TypeError);
}
