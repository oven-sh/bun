import { test, spyOn } from "bun:test";
function makeBag(tag) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return { tag }; }
function use(bag) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return "a".concat(bag); }
function tagOf(bag) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return bag.tag; }
test("a member of Object.prototype replaced: a row converts a literal", () => {
  const spy = spyOn(Object.prototype, "toString");
  let kind = "", out;
  for (let i = 0; i < 300; i++) { const bag = makeBag("text"); out = use(bag); spy.mock.contexts[spy.mock.contexts.length - 1].tag = 7; kind = typeof tagOf(bag); }
  spy.mockRestore();
  console.log(String(out), kind);
});
