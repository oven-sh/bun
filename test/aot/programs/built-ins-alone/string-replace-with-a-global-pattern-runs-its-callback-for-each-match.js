console.log("banana".replace(/(a)(n)/g, function (match, first, second, offset, text) {
  console.log(match.length, first, second, offset + 1, text.length, arguments.length);
  return first.toUpperCase();
}));
