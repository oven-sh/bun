const rewriter = new HTMLRewriter();
rewriter.on("a", {
  element(element) {
    element.replace("replaced");
  },
});
rewriter.on("b", {
  element(element) {
    console.log(element.removed);
    element.remove();
    console.log(element.removed);
  },
});
rewriter.on("i", {
  element(element) {
    element.removeAndKeepContent();
  },
});
rewriter.on("u", {
  element(element) {
    element.setInnerContent("inner");
  },
});
console.log(await rewriter.transform(new Response("<a>1</a><b>2</b><i>3</i><u>4</u>")).text());
