function down(n, acc) {
  if (n === 0) return acc;
  return up.apply(null, arguments);
}
function up(n, acc) {
  return down(n - 1, acc + 1);
}
let answer;
try { answer = String(down(1000000, 0)); } catch (error) { answer = error.constructor.name; }
console.log(answer);
