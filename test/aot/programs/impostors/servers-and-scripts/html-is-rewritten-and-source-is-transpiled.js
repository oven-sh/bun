const page = '<!doctype html><html><head><title>Old</title></head><body><a href="/a" class="x">one</a><img src="p.png"><a href="http://h/b">two</a><!-- note --><p id="gone">bye</p><script>let a = "<a>";</script></body></html>';
const links = [];
const rewriter = new HTMLRewriter()
  .on("a[href]", {
    element(element) {
      links.push(element.getAttribute("href") + " " + element.hasAttribute("class") + " " + element.tagName);
      if (element.getAttribute("href").startsWith("/")) element.setAttribute("href", "https://example.com" + element.getAttribute("href"));
      element.removeAttribute("class");
      element.append("!", { html: false });
    },
    text(text) {
      if (text.text) links.push("text " + text.text + " " + text.lastInTextNode);
    },
  })
  .on("title", { element: element => void element.setInnerContent("New & <improved>") })
  .on("img", { element: element => void element.after("<figcaption>picture</figcaption>", { html: true }).setAttribute("alt", '"quoted"') })
  .on("#gone", { element: element => void element.remove() })
  .on("body", { element: element => void element.onEndTag(end => void end.before("<footer></footer>", { html: true })) })
  .onDocument({ comments: comment => void comment.replace("<!-- " + comment.text.trim().toUpperCase() + " -->", { html: true }), doctype: doctype => void links.push("doctype " + doctype.name), end: end => void end.append("<!-- end -->", { html: true }) });
console.log(await rewriter.transform(new Response(page)).text());
console.log(links, rewriter.transform("<a href='/s'>string in, string out</a>"));
try {
  new HTMLRewriter().on("a[", {});
} catch (error) {
  console.log(error.name);
}
console.log(await new HTMLRewriter().on("p", { element() { throw new RangeError("handler failed"); } }).transform(new Response("<p>x</p>")).text().catch(error => error.message));

const transpiler = new Bun.Transpiler({ loader: "tsx", target: "bun", define: { "process.env.MODE": '"test"' } });
console.log(transpiler.transformSync("const n: number = 1; export const view = <div id={process.env.MODE}>{n as any}</div>; enum E { A }").trim().split("\n").length > 1);
console.log(transpiler.scan("import a, { b } from './x'; import type { T } from './t'; export const c = 1; export default 2; const d = require('y'); import('./z');"));
console.log(transpiler.scanImports("import './side'; export * from './all';"), (await transpiler.transform("let x: string = `a`;", "ts")).trim());
try {
  transpiler.transformSync("const = ;");
} catch (error) {
  console.log(error.name, Array.isArray(error.errors) || typeof error.message);
}
