// A greedy run at the end of one alternative of a repeated group; another alternative of the group is an assertion alone.
// Where the run has taken all it can, the assertion of the next turn fails; one character back it holds. So the run has to give back.
const show = match => (match === null ? "null" : match.index + " " + JSON.stringify(Array.from(match)));
console.log(show(/^(?:-b*|\b){2}/.exec("-ba")));
console.log(show(/(?:\nb*|\b){3}/.exec("\nba")));
console.log(show(/^(?:-b*|(?!a)){2}/.exec("-ba")));
console.log(show(/^(?:-b*|(?<=-b)){2}/.exec("-bb")));
console.log(show(/^(?:-(?:b)*|\b){2}/.exec("-ba")));
console.log(show(/^(?:-(b)*|\b){2}/.exec("-ba")));
console.log(show(/^(?:-[a-c]+|\b)+,/.exec("-abc,")));
console.log(show(/^(?:\w+|\b-|\B)+?$/.exec("ab-cd")));
console.log("key=value".replace(/^(?:\w*|\b)+=/, "<$&>"));
console.log("-ba".replace(/^(?:-b*|\b){2}/, "<$&>"), /^(?:-b*|\b){2}/.test("-ba"), "-ba".search(/^(?:-b*|\b){2}/));
