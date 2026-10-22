for (const match of "a1b".matchAll(/(?<letter>[a-z])(?<digit>\d)?/g)) {
  console.log(match.groups.letter.length, typeof match.groups.digit, match[2] === undefined, match.index + 1);
}
