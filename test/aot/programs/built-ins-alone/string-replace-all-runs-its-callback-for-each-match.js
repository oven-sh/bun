console.log("banana".replaceAll("an", (match, offset) => {
  console.log(match.length, offset + 1);
  return offset;
}));
