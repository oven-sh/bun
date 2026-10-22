console.log("a1b".replace(/(?<letter>[a-z])(?<digit>\d)?/g, (whole, letter, digit, offset, text, groups) => {
  console.log(typeof groups, groups.letter.length, typeof groups.digit);
  return groups.letter.toUpperCase();
}));
