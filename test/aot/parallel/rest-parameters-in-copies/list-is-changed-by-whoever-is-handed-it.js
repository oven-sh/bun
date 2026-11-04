const unseen = (0, eval)("(xs) => { xs.push('unseen'); xs[0] = 'changed'; }");
function inner(a, b, c) { return [a, b, c, arguments.length].join(); }
function hands(...xs) { unseen(xs); return inner(...xs); }
function change(xs) { xs.length = 0; xs.push("seen"); }
function handsToSeen(...xs) { change(xs); return inner(...xs); }
for (let i = 0; i < 3; i++) console.log(hands(i, 2), handsToSeen(i, 2));
