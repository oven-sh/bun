function show(n) {
  return "total " + n;
}
function add(list) {
  return list.reduce((a, b) => a + b, 0);
}
export { show as shown, add as total };
