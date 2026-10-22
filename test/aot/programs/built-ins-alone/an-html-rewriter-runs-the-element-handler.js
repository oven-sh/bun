const rewriter = new HTMLRewriter();
rewriter.on("p", {
  element(element) {
    console.log(element.tagName, element.getAttribute("class").length, element.getAttribute("missing") === null, element.hasAttribute("class"), [...element.attributes][0].join(), arguments.length);
  },
});
console.log(await rewriter.transform(new Response("<p class=\"big\">text</p>")).text());
