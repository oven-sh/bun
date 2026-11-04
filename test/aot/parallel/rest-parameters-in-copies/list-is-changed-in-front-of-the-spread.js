function inner(a, b, c, d) { return [a, b, c, d, arguments.length].join(); }
function pushes(...xs) { xs.push("pushed"); return inner(...xs); }
function stores(...xs) { xs[0] = "stored"; return inner(...xs); }
function shortens(...xs) { xs.length = 1; return inner(...xs); }
function lengthens(...xs) { xs.length = 4; return inner(...xs); }
function reverses(...xs) { xs.reverse(); return inner(...xs); }
function deletes(...xs) { delete xs[0]; return inner(...xs); }
function storesFar(...xs) { xs[3] = "far"; return inner(...xs); }
function pops(...xs) { const last = xs.pop(); return inner(...xs) + "|" + last; }
function shifts(...xs) { const first = xs.shift(); return inner(...xs) + "|" + first; }
function sorts(...xs) { xs.sort(); return inner(...xs); }
function splices(...xs) { xs.splice(1, 1, "x", "y"); return inner(...xs); }
for (let i = 0; i < 3; i++)
  console.log(pushes(i, 2), stores(i, 2), shortens(i, 2), lengthens(i, 2), reverses(i, 2), deletes(i, 2), storesFar(i, 2), pops(i, 2), shifts(i, 2), sorts(3 - i, 2), splices(i, 2, 3));
