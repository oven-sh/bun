import { test } from "bun:test";
function makeBag(tag) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return { tag }; }
function use(bag) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return new Intl.NumberFormat("en-US", bag).format(1.25); }
function tagOf(bag) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return bag.tag; }
test("a name above a bag that lists none", () => {
  Object.defineProperty(Object.prototype, "maximumFractionDigits", { get() { if (this && this.tag === "text") this.tag = 7; return 1; }, configurable: true });
  let kind = "", out;
  for (let i = 0; i < 300; i++) { const bag = makeBag("text"); out = use(bag); kind = typeof tagOf(bag); }
  delete Object.prototype.maximumFractionDigits;
  console.log(String(out), kind);
});
