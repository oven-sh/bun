import { test } from "bun:test";
function makeBag(tag) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return { tag }; }
function show(n, bag) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return n.toLocaleString("en-US", bag); }
function tagOf(bag) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return bag.tag; }
test("an option above a bag that lists none", () => {
  Object.defineProperty(Object.prototype, "maximumFractionDigits", { get() { this.tag = 7; return 1; }, configurable: true });
  let kind = "", text = "";
  for (let i = 0; i < 300; i++) { const bag = makeBag("text"); text = show(1.25, bag); kind = typeof tagOf(bag); }
  delete Object.prototype.maximumFractionDigits;
  console.log(text, kind);
});
