const rewriter = new HTMLRewriter();
rewriter.onDocument({
  doctype(doctype) {
    console.log(doctype.name, doctype.publicId === null, doctype.systemId === null);
  },
  end(end) {
    end.append("<!-- end -->", { html: true });
  },
});
console.log(await rewriter.transform(new Response("<!DOCTYPE html><p>text</p>")).text());
