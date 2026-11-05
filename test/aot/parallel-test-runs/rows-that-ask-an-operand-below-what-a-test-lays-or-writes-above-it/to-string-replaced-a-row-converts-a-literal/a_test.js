import { test } from "bun:test";
function makeBag(tag) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return { tag }; }
function glue(text, bag) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return text.concat(bag); }
function tagOf(bag) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return bag.tag; }
test("Object.prototype.toString replaced: a row converts a literal", () => {
  const original = Object.prototype.toString;
  Object.prototype.toString = function () { if (this && this.tag === "text") this.tag = 7; return "!"; };
  let kind = "", text = "";
  for (let i = 0; i < 300; i++) { const bag = makeBag("text"); text = glue("a", bag); kind = typeof tagOf(bag); }
  Object.prototype.toString = original;
  console.log(text, kind);
});
