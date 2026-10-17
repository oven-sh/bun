// Static private fields of every type are read, tested with `in` and written before their initializer has run, in classes created inside a function (the same program without type annotations).
function said(f) { try { return String(f()); } catch (e) { return "threw " + (e).name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
const collect = (globalThis).gc ?? (() => (globalThis).Bun.gc(true));
function show(v) { return typeof v === "function" || typeof v === "object" ? typeof v : String(v); }
function make_number(round) { class K {
    static has() { return #b in K; }
    static read() { return show(K.#b); }
    static readThis() { return show(this.#b); }
    static write(v) { K.#b = v; return "stored"; }
    static add() { (K).#b += 1; return "added"; }
    static increment() { (K).#b++; return "incremented"; }
    static or() { (K).#b ||= 5; return "or"; }
    static nullish() { (K).#b ??= 5; return "nullish"; }
    static pattern() { [K.#b] = [5]; return "pattern"; }
    static call() { return (K).#b(); }
    static kind() { return typeof K.#b; }
    static all(when) {
      for (const door of ["has", "read", "readThis", "kind", "add", "increment", "or", "nullish", "pattern", "call", "has", "read"]) row("made number " + round + " " + when + " " + door, () => (K)[door]());
      row("made number " + round + " " + when + " write", () => K.write(5));
      row("made number " + round + " " + when + " has behind the write", () => K.has());
    }
    static { K.all("in a block ahead"); }
    static #b = 5;
    static { K.all("behind"); }
} return K; }
make_number(1); make_number(2).all("later");
function make_string(round) { class K {
    static has() { return #b in K; }
    static read() { return show(K.#b); }
    static readThis() { return show(this.#b); }
    static write(v) { K.#b = v; return "stored"; }
    static add() { (K).#b += "x"; return "added"; }
    static increment() { (K).#b += "y"; return "incremented"; }
    static or() { (K).#b ||= "five"; return "or"; }
    static nullish() { (K).#b ??= "five"; return "nullish"; }
    static pattern() { [K.#b] = ["five"]; return "pattern"; }
    static call() { return (K).#b(); }
    static kind() { return typeof K.#b; }
    static all(when) {
      for (const door of ["has", "read", "readThis", "kind", "add", "increment", "or", "nullish", "pattern", "call", "has", "read"]) row("made string " + round + " " + when + " " + door, () => (K)[door]());
      row("made string " + round + " " + when + " write", () => K.write("five"));
      row("made string " + round + " " + when + " has behind the write", () => K.has());
    }
    static { K.all("in a block ahead"); }
    static #b = "five";
    static { K.all("behind"); }
} return K; }
make_string(1); make_string(2).all("later");
function make_boolean(round) { class K {
    static has() { return #b in K; }
    static read() { return show(K.#b); }
    static readThis() { return show(this.#b); }
    static write(v) { K.#b = v; return "stored"; }
    static add() { (K).#b &&= false; return "added"; }
    static increment() { (K).#b ||= true; return "incremented"; }
    static or() { (K).#b ||= true; return "or"; }
    static nullish() { (K).#b ??= true; return "nullish"; }
    static pattern() { [K.#b] = [true]; return "pattern"; }
    static call() { return (K).#b(); }
    static kind() { return typeof K.#b; }
    static all(when) {
      for (const door of ["has", "read", "readThis", "kind", "add", "increment", "or", "nullish", "pattern", "call", "has", "read"]) row("made boolean " + round + " " + when + " " + door, () => (K)[door]());
      row("made boolean " + round + " " + when + " write", () => K.write(true));
      row("made boolean " + round + " " + when + " has behind the write", () => K.has());
    }
    static { K.all("in a block ahead"); }
    static #b = true;
    static { K.all("behind"); }
} return K; }
make_boolean(1); make_boolean(2).all("later");
function make_object(round) { class K {
    static has() { return #b in K; }
    static read() { return show(K.#b); }
    static readThis() { return show(this.#b); }
    static write(v) { K.#b = v; return "stored"; }
    static add() { (K).#b &&= { v: 6 }; return "added"; }
    static increment() { (K).#b &&= { v: 7 }; return "incremented"; }
    static or() { (K).#b ||= { v: 5 }; return "or"; }
    static nullish() { (K).#b ??= { v: 5 }; return "nullish"; }
    static pattern() { [K.#b] = [{ v: 5 }]; return "pattern"; }
    static call() { return (K).#b(); }
    static kind() { return typeof K.#b; }
    static all(when) {
      for (const door of ["has", "read", "readThis", "kind", "add", "increment", "or", "nullish", "pattern", "call", "has", "read"]) row("made object " + round + " " + when + " " + door, () => (K)[door]());
      row("made object " + round + " " + when + " write", () => K.write({ v: 5 }));
      row("made object " + round + " " + when + " has behind the write", () => K.has());
    }
    static { K.all("in a block ahead"); }
    static #b = { v: 5 };
    static { K.all("behind"); }
} return K; }
make_object(1); make_object(2).all("later");
function make_nullable(round) { class K {
    static has() { return #b in K; }
    static read() { return show(K.#b); }
    static readThis() { return show(this.#b); }
    static write(v) { K.#b = v; return "stored"; }
    static add() { (K).#b += 1; return "added"; }
    static increment() { (K).#b++; return "incremented"; }
    static or() { (K).#b ||= undefined; return "or"; }
    static nullish() { (K).#b ??= undefined; return "nullish"; }
    static pattern() { [K.#b] = [undefined]; return "pattern"; }
    static call() { return (K).#b(); }
    static kind() { return typeof K.#b; }
    static all(when) {
      for (const door of ["has", "read", "readThis", "kind", "add", "increment", "or", "nullish", "pattern", "call", "has", "read"]) row("made nullable " + round + " " + when + " " + door, () => (K)[door]());
      row("made nullable " + round + " " + when + " write", () => K.write(undefined));
      row("made nullable " + round + " " + when + " has behind the write", () => K.has());
    }
    static { K.all("in a block ahead"); }
    static #b = undefined;
    static { K.all("behind"); }
} return K; }
make_nullable(1); make_nullable(2).all("later");
function make_function(round) { class K {
    static has() { return #b in K; }
    static read() { return show(K.#b); }
    static readThis() { return show(this.#b); }
    static write(v) { K.#b = v; return "stored"; }
    static add() { (K).#b &&= () => 6; return "added"; }
    static increment() { (K).#b &&= () => 7; return "incremented"; }
    static or() { (K).#b ||= () => 5; return "or"; }
    static nullish() { (K).#b ??= () => 5; return "nullish"; }
    static pattern() { [K.#b] = [() => 5]; return "pattern"; }
    static call() { return (K).#b(); }
    static kind() { return typeof K.#b; }
    static all(when) {
      for (const door of ["has", "read", "readThis", "kind", "add", "increment", "or", "nullish", "pattern", "call", "has", "read"]) row("made function " + round + " " + when + " " + door, () => (K)[door]());
      row("made function " + round + " " + when + " write", () => K.write(() => 5));
      row("made function " + round + " " + when + " has behind the write", () => K.has());
    }
    static { K.all("in a block ahead"); }
    static #b = () => 5;
    static { K.all("behind"); }
} return K; }
make_function(1); make_function(2).all("later");
function make_anything(round) { class K {
    static has() { return #b in K; }
    static read() { return show(K.#b); }
    static readThis() { return show(this.#b); }
    static write(v) { K.#b = v; return "stored"; }
    static add() { (K).#b += 1; return "added"; }
    static increment() { (K).#b++; return "incremented"; }
    static or() { (K).#b ||= 5; return "or"; }
    static nullish() { (K).#b ??= 5; return "nullish"; }
    static pattern() { [K.#b] = [5]; return "pattern"; }
    static call() { return (K).#b(); }
    static kind() { return typeof K.#b; }
    static all(when) {
      for (const door of ["has", "read", "readThis", "kind", "add", "increment", "or", "nullish", "pattern", "call", "has", "read"]) row("made anything " + round + " " + when + " " + door, () => (K)[door]());
      row("made anything " + round + " " + when + " write", () => K.write(5));
      row("made anything " + round + " " + when + " has behind the write", () => K.has());
    }
    static { K.all("in a block ahead"); }
    static #b = 5;
    static { K.all("behind"); }
} return K; }
make_anything(1); make_anything(2).all("later");
