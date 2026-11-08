function* pair(first, second) { yield first; yield second; }
function rounds(count) {
    let s0 = "", s1 = "", s2 = "";
    let seen = 0;
    for (let round = 0; round < count; round++) { for (const value of pair(round, round + 1)) seen += value; s0 += "-"; s1 += "-"; s2 += "-"; }
    return [s0.length + s1.length + s2.length, s0.slice(-3) + s1.slice(-3) + s2.slice(-3), seen].join(" ");
}
console.log(rounds(40));
