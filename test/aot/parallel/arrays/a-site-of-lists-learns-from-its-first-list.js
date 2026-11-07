// each site makes a few empty lists that turn into another kind of storage at once: by a spread, a push, a store far behind the end, a fraction; what they hold is printed
// The birth of the second list of a site looks at what became of the first, so only the first spread at each site leaves its stub for the run time.
// COUNT: operation:operationAOTAppendElements <= 4
// COUNT: operation:operationAOTAppendMembers <= 4
function spread(source) { return [...source]; }
function pushed(a, b) { const out = []; out.push(a); out.push(b); return out; }
function sparse(value) { const out = []; out[100000] = value; return out; }
function mixed(turn) { const out = []; out.push(turn); if (turn & 1) out.push(turn + 0.5); if (turn & 2) out.push("text" + turn); return out; }
function called(...rest) { return rest.length + ":" + rest.join(); }
function passedOn(list) { return called(...list); }
for (let turn = 0; turn < 70; turn++) {
    const lines = [
        spread(turn % 3 ? ["a" + turn, "b"] : [turn, turn + 1]).join(),
        spread(new Set([turn, "s" + turn])).join(),
        spread(new Map([[turn, { turn }]]).keys()).join(),
        spread("xy" + turn).join("|"),
        pushed(turn, "t").join(),
        pushed(0.5, turn).join(),
        String(sparse(turn).length) + sparse(turn)[100000],
        mixed(turn).join(),
        passedOn([turn, "u", 1.5]),
    ];
    if (turn < 4 || turn > 62) console.log(turn, lines.join(" ; "));
}
