function* pair(first, second) { yield first; yield second; }
function rounds() {
    let seen = 0;
    let said = "";
    for (let round = 0; round < 12; round++) {
        for (const value of pair(1, 2)) said += value;
        said += typeof seen === "number" ? seen + 1 : seen.length;
        seen = round % 3 ? round : "r" + round;
    }
    return said;
}
console.log(rounds());
