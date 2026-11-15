var a; let n = 0;
for (let i = 0; i < 3; i++) { if ((a = process) != null) n += a.pid > 0 ? 1 : 0; }
console.log(n);
