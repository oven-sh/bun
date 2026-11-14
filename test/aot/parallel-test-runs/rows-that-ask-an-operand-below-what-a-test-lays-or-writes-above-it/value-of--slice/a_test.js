import { test, spyOn } from "bun:test";
function makeBag(tag) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return { tag }; }
function use(bag) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return [1, 2, 3].slice(bag).length; }
function tagOf(bag) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return bag.tag; }
test("a member of Object.prototype replaced: a row converts a literal", () => {
  const original = Object.prototype.valueOf; Object.prototype.valueOf = function () { if (this && this.tag === "text") this.tag = 7; return 1; };
  let kind = "", out;
  for (let i = 0; i < 300; i++) { const bag = makeBag("text"); out = use(bag); kind = typeof tagOf(bag); }
  Object.prototype.valueOf = original;
  console.log(String(out), kind);
});
