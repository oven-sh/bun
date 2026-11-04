function* each(...xs) { for (const x of xs) yield x * 2; }
async function later(...xs) { return xs.length + (await xs[0]); }
function spreadInto(...xs) { return [...each(...xs)].join(); }
for (let i = 0; i < 3; i++) console.log(spreadInto(i, 1, 2), spreadInto());
later(5, 6).then(value => console.log(value));
