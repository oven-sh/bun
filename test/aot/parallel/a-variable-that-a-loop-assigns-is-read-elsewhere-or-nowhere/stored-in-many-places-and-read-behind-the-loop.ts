const n = (value: number) => Number(process.argv[8] ?? value);
function run(limit: number) { let kind = "none"; for (let i = 0; i < limit; i++) { switch (i % 11) { case 0: kind = "a"; break; case 1: kind = "b"; break; case 2: kind = "c"; break; case 3: kind = "d"; break; case 4: kind = "e"; break; case 5: kind = "f"; break; case 6: kind = "g"; break; case 7: kind = "h"; break; case 8: kind = "i"; break; case 9: kind = "j"; break; } } return kind; }
console.log(run(n(1)), run(n(5)), run(n(10)), run(n(11)), run(n(0)));
