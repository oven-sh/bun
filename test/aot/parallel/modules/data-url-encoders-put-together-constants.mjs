// A data: URL that `+`, a template, encodeURIComponent() and btoa() put together from constants is text of the program: an import of it runs the text.
const code = `export default function twice(value) { return value + value; }`;
const show = async (what, load) => {
  try {
    console.log(what + ":", (await load()).default(2));
  } catch (error) {
    console.log(what + ": refused", error.code);
  }
};
await show("joined", () => import("data:text/javascript," + code));
await show("in base64", () => import("data:text/javascript;base64," + btoa(code)));
await show("percent-encoded", () => import("data:text/javascript," + encodeURIComponent(code)));
await show("in base64 in a template", () => import(`data:text/javascript;base64,${btoa(code)}`));
await show(
  "a text with a character outside ASCII",
  () => import("data:text/javascript," + encodeURIComponent("export default value => 'é€' + value;")),
);
const url = "data:text/javascript;base64," + btoa("export default value => value * 3;");
await show("through a variable", () => import(url));
const encoded = btoa("export default value => value * 5;");
await show("the encoded part through a variable", () => import("data:text/javascript;base64," + encoded));
