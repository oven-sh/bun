console.log("banana".replace("an", function (match, offset, text) {
  console.log(match.length, offset + 1, text.length, this === undefined, arguments.length);
  return 1.5;
}));
