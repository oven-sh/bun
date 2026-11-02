// The characters of a String object are neither writable nor configurable: strict code that stores to one, deletes one or defines another value over one gets a TypeError, and the character stays. From the length on the indexes are ordinary.
function line(name, body) {
  try {
    console.log(name, JSON.stringify(body()));
  } catch (error) {
    console.log(name, "threw", error.constructor.name);
  }
}

line("store over a character", () => { const text = new String("abc"); text[1] = "z"; return text[1]; });
line("the character after a refused store", () => { const text = new String("abc"); try { text[1] = 5; } catch {} const found = text[1]; return [typeof found, found, found.length]; });
line("store past the end", () => { const text = new String("abc"); text[3] = 5; text[9] = null; return [typeof text[3], text[3], text[9], text.length, Object.keys(text), typeof text[1]]; });
line("store of an object past the end", () => { const text = new String("a"); text[1] = { inner: 1 }; return [typeof text[1], text[1].inner, typeof text[0], text[0].length]; });
line("store under every index", () => { const text = new String("ab"); const seen = []; for (let index = 0; index < 4; index++) { try { text[index] = index; seen.push("stored"); } catch { seen.push("refused"); } } return [seen, [0, 1, 2, 3].map(index => typeof text[index])]; });
line("store to the length", () => { const text = new String("abc"); text.length = 1; return text.length; });
line("delete of a character", () => { const text = new String("abc"); return delete text[1]; });
line("the character after a refused delete", () => { const text = new String("abc"); try { delete text[1]; } catch {} return [typeof text[1], text[1].length, 1 in text]; });
line("delete past the end", () => { const text = new String("abc"); text[4] = 1; return [delete text[4], delete text[7], 4 in text, typeof text[4]]; });
line("define another value", () => { const text = new String("abc"); Object.defineProperty(text, "1", { value: "z" }); return text[1]; });
line("define the same value", () => { const text = new String("abc"); Object.defineProperty(text, "1", { value: "b" }); return [text[1], text[1].length]; });
line("define an accessor", () => { const text = new String("abc"); Object.defineProperty(text, 0, { get() { return 1; } }); return text[0]; });
line("define past the end", () => { const text = new String("abc"); Object.defineProperty(text, 3, { value: 7, enumerable: false }); return [text[3], typeof text[3], Object.keys(text), typeof text[2]]; });
line("define an accessor past the end", () => { const text = new String("ab"); Object.defineProperty(text, 2, { get() { return { made: true }; }, configurable: true }); return [typeof text[2], text[2].made, typeof text[1]]; });
line("Reflect refuses without throwing", () => { const text = new String("abc"); return [Reflect.set(text, 1, "z"), Reflect.deleteProperty(text, 1), Reflect.defineProperty(text, 1, { value: "z" }), Reflect.set(text, 3, "z"), text[1], text[3]]; });
line("store through an heir", () => { const heir = Object.create(new String("abc")); heir[1] = "z"; return heir[1]; });
line("store of a number through an heir", () => { const heir = Object.create(new String("abc")); try { heir[1] = 5; } catch {} return [typeof heir[1], heir[1].length, Object.hasOwn(heir, 1)]; });
line("store through an heir past the end", () => { const heir = Object.create(new String("abc")); heir[3] = 5; return [heir[3], Object.hasOwn(heir, 3), typeof heir[0]]; });
line("define on an heir", () => { const heir = Object.create(new String("abc")); Object.defineProperty(heir, 1, { value: 5 }); return [typeof heir[1], heir[1], typeof heir[0]]; });
line("frozen", () => { const text = Object.freeze(new String("ab")); try { text[2] = 1; } catch {} return [typeof text[0], typeof text[2], Object.isFrozen(text)]; });
line("fill and reverse", () => { const seen = []; for (const change of [text => Array.prototype.fill.call(text, "x"), text => Array.prototype.reverse.call(text), text => Array.prototype.push.call(text, "x"), text => Array.prototype.pop.call(text)]) { const text = new String("ab"); try { change(text); seen.push("done"); } catch (error) { seen.push(error.constructor.name); } seen.push(typeof text[0], text[0]); } return seen; });
line("a field of a class below String", () => { class Numbered extends String { 0 = "field"; } try { return new Numbered("abc")[0]; } catch (error) { return [error.constructor.name, new Numbered("")[0]]; } });
