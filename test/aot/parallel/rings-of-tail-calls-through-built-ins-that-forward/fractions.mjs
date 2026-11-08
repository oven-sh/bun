let work = 0;
function ping(n) { for (let i = 0; i < 2; i++) work = (work + n + i) | 0; if (n === 0) return 7.5; return Reflect.apply(pong, undefined, [n]); }
function pong(n) { for (let i = 0; i < 2; i++) work = (work ^ (n + i)) | 0; return ping(n - 1); }
let answer;
try { answer = ping(3000000); } catch (error) { answer = error.constructor.name; }
console.log(answer);
