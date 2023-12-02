Bun provides a fast native implementation of the `HTMLRewriter` pattern developed by Cloudflare. It provides a convenient, `EventListener`-like API for traversing and transforming HTML documents.

```ts
const rewriter = new HTMLRewriter();

rewriter.on("*", {
  element(el) {
    console.log(el.tagName); // "body" | "div" | ...
  },
});
```

To parse and/or transform the HTML:

```ts#rewriter.ts
rewriter.transform(
  new Response(`
<!DOCTYPE html>
<html>
<!-- comment -->
<head>
  <title>My First HTML Page</title>
</head>
<body>
  <h1>My First Heading</h1>
  <p>My first paragraph.</p>
</body>
`));
```

View the full documentation on the [Cloudflare website](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/).
