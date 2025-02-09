import { bench, run } from "../runner.mjs";

const blob = new Blob(["<p id='foo'>Hello</p>"]);
bench("prepend", async () => {
  await new HTMLRewriter()
    .on("p", {
      element(element) {
        element.prepend("Hello");
      },
    })
    .transform(new Response(blob))
    .text();
});

bench("append", async () => {
  await new HTMLRewriter()
    .on("p", {
      element(element) {
        element.append("Hello");
      },
    })
    .transform(new Response(blob))
    .text();
});

bench("getAttribute", async () => {
  await new HTMLRewriter()
    .on("p", {
      element(element) {
        element.getAttribute("id");
      },
    })
    .transform(new Response(blob))
    .text();
});

await run();
