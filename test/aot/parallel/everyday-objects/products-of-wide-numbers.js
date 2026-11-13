// Products of large whole numbers split into halves and added again
function multiply(a, b) {
  const low = (a & 0xffff) * (b & 0xffff);
  const middle = (a >>> 16) * (b & 0xffff) + (a & 0xffff) * (b >>> 16);
  const high = (a >>> 16) * (b >>> 16);
  return ((low + (middle << 16)) >>> 0) + high * 0;
}
function run(list) {
  let hash = 0x811c9dc5;
  for (const n of list) hash = multiply(hash ^ n, 0x01000193);
  return hash + " " + list.map(n => multiply(n, 65537)).join() + " " + list.map(n => (multiply(n, n) | 0)).join();
}
console.log(run([1, 2, 3]));
console.log(run([65535, 65536, 4294967295]));
console.log(run([0, 305419896]));
