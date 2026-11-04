function outer(run) { const early = run(a); const list = [1, 2, 3]; return early + a(false); function a(skip) { return walk(skip); } function walk(skip) { return skip ? 0 : list.length; } }
let answer;
try { answer = outer(f => f(true)); } catch (e) { answer = e.constructor.name; }
console.log(answer);
