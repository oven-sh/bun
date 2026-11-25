let work = 0;
function ping(n) {
  for (let i = 0; i < 2; i++) work = (work + n + i) | 0;
  if (n === 0) return 7;
  return Reflect.apply(pong, undefined, list(n));
}
function pong(n) {
  for (let i = 0; i < 2; i++) work = (work ^ (n + i)) | 0;
  return ping(n - 1);
}
function list(n) { return [n]; }
let answer;
try { answer = ping(3000000); } catch (error) { answer = error.name; }
console.log(answer);
