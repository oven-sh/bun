import { test } from "bun:test";
function makeBag(tag) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return { tag }; }
function count() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return arguments.length; }
function use(bag) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return count.apply(undefined, bag); }
function tagOf(bag) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return bag.tag; }
test("a name above a bag that lists none", () => {
  Object.defineProperty(Object.prototype, "length", { get() { if (this && this.tag === "text") this.tag = 7; return 0; }, configurable: true });
  let kind = "", out;
  for (let i = 0; i < 300; i++) { const bag = makeBag("text"); out = use(bag); kind = typeof tagOf(bag); }
  delete Object.prototype.length;
  console.log(String(out), kind);
});
