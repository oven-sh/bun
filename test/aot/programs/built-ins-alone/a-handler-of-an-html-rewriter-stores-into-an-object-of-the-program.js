const seen = { name: 0 };
const rewriter = new HTMLRewriter();
rewriter.on("p", {
  element(element) {
    seen.name = element.tagName;
  },
});
console.log(await rewriter.transform(new Response("<p>text</p>")).text());
console.log(typeof seen.name, seen.name.length);
