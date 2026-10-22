const rewriter = new HTMLRewriter();
rewriter.on("br", {
  element(element) {
    console.log(typeof element.namespaceURI, element.selfClosing, element.canHaveContent);
  },
});
console.log(await rewriter.transform(new Response("<br/>")).text());
