console.log("a1b".replace(/([a-z])(\d)?/g, (whole, letter, digit, offset, text) => {
  console.log(typeof whole, typeof letter, typeof digit, digit === undefined, offset + 1, text.length);
  return "-";
}));
