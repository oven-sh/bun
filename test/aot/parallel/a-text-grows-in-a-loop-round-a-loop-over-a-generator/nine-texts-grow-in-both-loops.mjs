function* pair(first, second) { yield first; yield second; }
function rounds(count) {
    let s0 = "", s1 = "", s2 = "", s3 = "", s4 = "", s5 = "", s6 = "", s7 = "", s8 = "";
    let seen = 0;
    for (let round = 0; round < count; round++) { for (const value of pair(round, round + 1)) { s0 += value; s1 += value; s2 += value; s3 += value; s4 += value; s5 += value; s6 += value; s7 += value; s8 += value; } s0 += "-"; s1 += "-"; s2 += "-"; s3 += "-"; s4 += "-"; s5 += "-"; s6 += "-"; s7 += "-"; s8 += "-"; }
    return [s0.length + s1.length + s2.length + s3.length + s4.length + s5.length + s6.length + s7.length + s8.length, s0.slice(-3) + s1.slice(-3) + s2.slice(-3), seen].join(" ");
}
console.log(rounds(40));
