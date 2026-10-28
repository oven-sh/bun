for (const pairs of [2, 16, 64, 256, 1024, 4096]) {
  let text = "";
  for (let i = 0; i < pairs; i++) text += String.fromCharCode(65 + (i % 26), 97 + (i % 26));
  let first = null;
  text.replace(/(..)/g, match => {
    first ??= [match, RegExp.lastMatch, RegExp.$1, RegExp.leftContext.length].join();
    return match;
  });
  console.log(pairs, first);
}
