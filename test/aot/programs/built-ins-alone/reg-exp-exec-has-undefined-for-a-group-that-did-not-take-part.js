const match = /(?<year>\d+)(?<suffix>x)?/.exec("in 2026");
console.log(match[1].length, match[2] === undefined, typeof match[2], match.index + 1);
console.log(match.groups.year.length, match.groups.suffix === undefined, typeof match.groups.suffix, match.groups.suffix ?? 0.5);
