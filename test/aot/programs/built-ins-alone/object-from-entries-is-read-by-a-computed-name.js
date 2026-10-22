const made = Object.fromEntries([["first", 1.5]]);
for (const key of ["first", "missing"]) console.log(typeof made[key], made[key]);
