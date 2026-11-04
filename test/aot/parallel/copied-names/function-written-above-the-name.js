function outer(t) { function walk(n) { stack.push(n); return () => stack.length; } if (!t) return 0; var stack = []; return walk(t)() + walk(t)(); }
console.log(outer(0), outer(1));
