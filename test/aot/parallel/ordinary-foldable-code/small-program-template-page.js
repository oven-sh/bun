const TITLE = "Home";
const ITEMS = ["one", "two", "three"];
const SHOW_FOOTER = false;
const page = `<h1>${TITLE}</h1>
<ul>
${ITEMS.map((i) => `  <li>${i}</li>`).join("\n")}
</ul>${SHOW_FOOTER ? "\n<footer>bye</footer>" : ""}`;
console.log(page);
