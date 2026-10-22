const match = "in 2026".match(/(?<year>\d+)(?<suffix>x)?/);
console.log(match[2] === undefined, match.groups.suffix === undefined, match.groups.year.length);
