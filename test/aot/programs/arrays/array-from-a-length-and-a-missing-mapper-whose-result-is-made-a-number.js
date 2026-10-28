function run(x) {
  let r;
  try { r = Array.from({ length: 2 }, x); } catch (e) {}
  +r;
}
run();
console.log("ended");
