function reads(...xs) { return [xs[-1], xs[2], xs["1"], xs.length, xs.at(-1), xs.indexOf(2), "0" in xs, 5 in xs, Object.keys(xs).join("")].join(); }
function named(...xs) { xs.extra = "extra"; return xs.extra + xs.length + Object.keys(xs).join(""); }
for (let i = 0; i < 3; i++) console.log(reads(i, 2), reads(), named(i));
