const rewriter = new HTMLRewriter();
rewriter.on("p", {
  element(element) {
    element.onEndTag(function (tag) {
      console.log(tag.name, arguments.length);
      tag.before("[").after("]");
    });
  },
});
console.log(await rewriter.transform(new Response("<p>text</p>")).text());
