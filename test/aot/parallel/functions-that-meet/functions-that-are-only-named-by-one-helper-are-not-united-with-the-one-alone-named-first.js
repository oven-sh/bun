function label(f, text) { Object.defineProperty(f, "name", { value: text }); }
let few, more, alone;
function keepFew(f) { few = f; }
function keepMore(f) { more = f; }
function keepAlone(f) { alone = f; }
keepFew(x => x); keepFew(x => x + 1); keepFew(x => x + 2); keepFew(x => x + 3); keepFew(x => x + 4);
keepMore(s => s); keepMore(s => s + "a"); keepMore(s => s + "b"); keepMore(s => s + "c"); keepMore(s => s + "d");
keepAlone(() => 0);
label(alone, "alone"); label(few, "few"); label(more, "more");
console.log(few(1), more("t"));
