const rewriter = new HTMLRewriter();
rewriter.on("p", {
  text(chunk) {
    console.log(typeof chunk.text, chunk.text.length, chunk.lastInTextNode, chunk.removed);
    if (chunk.text.length > 0) chunk.before("<").after(">").replace(chunk.text.toUpperCase());
  },
});
console.log(await rewriter.transform(new Response("<p>text</p>")).text());
