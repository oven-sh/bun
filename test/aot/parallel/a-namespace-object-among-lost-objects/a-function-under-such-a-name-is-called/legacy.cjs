exports[["ta", "int"].join("")] = function (r) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; r.inner = 7; return 1 + work; };
