const rewriter = new HTMLRewriter();
rewriter.on("p", {
  element(element) {
    console.log(element.setAttribute("id", "one") === element, element.removeAttribute("class") === element);
    element.before("<b>").after("<i>", { html: true }).prepend("[").append("]");
  },
});
console.log(await rewriter.transform(new Response("<p class=\"big\">text</p>")).text());
