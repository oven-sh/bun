const rewriter = new HTMLRewriter();
rewriter.on("p", {
  comments(comment) {
    console.log(comment.text.length, comment.removed);
    comment.text = "changed";
    comment.before("[").after("]");
  },
});
console.log(await rewriter.transform(new Response("<p><!-- note --></p>")).text());
