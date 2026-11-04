function down(n, spare, acc) {
  if (n === 0) return acc + (spare === undefined ? 0 : 1000);
  delete arguments[1];
  return up.apply(null, arguments);
}
function up(n, spare, acc) {
  return down(n - 1, spare === undefined ? 5 : 6, acc + 1);
}
let answer;
try { answer = String(down(1000000, 5, 0)); } catch (error) { answer = error.constructor.name; }
console.log(answer);
