// Static private fields of every type are read, tested with `in` and written before their initializer has run, in classes created inside a function.
declare const console: { log(...a: unknown[]): void };
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown): void { console.log(label + ": " + said(f)); }
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));
function show(v: unknown) { return typeof v === "function" || typeof v === "object" ? typeof v : String(v); }
function make_number(round: number) { class K {
    static has() { return #b in K; }
    static read() { return show(K.#b); }
    static readThis() { return show(this.#b); }
    static write(v: number) { K.#b = v; return "stored"; }
    static add() { (K as any).#b += 1; return "added"; }
    static increment() { (K as any).#b++; return "incremented"; }
    static or() { (K as any).#b ||= 5; return "or"; }
    static nullish() { (K as any).#b ??= 5; return "nullish"; }
    static pattern() { [K.#b] = [5]; return "pattern"; }
    static call() { return (K as any).#b(); }
    static kind() { return typeof K.#b; }
    static all(when: string) {
      for (const door of ["has", "read", "readThis", "kind", "add", "increment", "or", "nullish", "pattern", "call", "has", "read"]) row("made number " + round + " " + when + " " + door, () => (K as any)[door]());
      row("made number " + round + " " + when + " write", () => K.write(5));
      row("made number " + round + " " + when + " has behind the write", () => K.has());
    }
    static { K.all("in a block ahead"); }
    static #b: number = 5;
    static { K.all("behind"); }
} return K; }
make_number(1); make_number(2).all("later");
function make_string(round: number) { class K {
    static has() { return #b in K; }
    static read() { return show(K.#b); }
    static readThis() { return show(this.#b); }
    static write(v: string) { K.#b = v; return "stored"; }
    static add() { (K as any).#b += "x"; return "added"; }
    static increment() { (K as any).#b += "y"; return "incremented"; }
    static or() { (K as any).#b ||= "five"; return "or"; }
    static nullish() { (K as any).#b ??= "five"; return "nullish"; }
    static pattern() { [K.#b] = ["five"]; return "pattern"; }
    static call() { return (K as any).#b(); }
    static kind() { return typeof K.#b; }
    static all(when: string) {
      for (const door of ["has", "read", "readThis", "kind", "add", "increment", "or", "nullish", "pattern", "call", "has", "read"]) row("made string " + round + " " + when + " " + door, () => (K as any)[door]());
      row("made string " + round + " " + when + " write", () => K.write("five"));
      row("made string " + round + " " + when + " has behind the write", () => K.has());
    }
    static { K.all("in a block ahead"); }
    static #b: string = "five";
    static { K.all("behind"); }
} return K; }
make_string(1); make_string(2).all("later");
function make_boolean(round: number) { class K {
    static has() { return #b in K; }
    static read() { return show(K.#b); }
    static readThis() { return show(this.#b); }
    static write(v: boolean) { K.#b = v; return "stored"; }
    static add() { (K as any).#b &&= false; return "added"; }
    static increment() { (K as any).#b ||= true; return "incremented"; }
    static or() { (K as any).#b ||= true; return "or"; }
    static nullish() { (K as any).#b ??= true; return "nullish"; }
    static pattern() { [K.#b] = [true]; return "pattern"; }
    static call() { return (K as any).#b(); }
    static kind() { return typeof K.#b; }
    static all(when: string) {
      for (const door of ["has", "read", "readThis", "kind", "add", "increment", "or", "nullish", "pattern", "call", "has", "read"]) row("made boolean " + round + " " + when + " " + door, () => (K as any)[door]());
      row("made boolean " + round + " " + when + " write", () => K.write(true));
      row("made boolean " + round + " " + when + " has behind the write", () => K.has());
    }
    static { K.all("in a block ahead"); }
    static #b: boolean = true;
    static { K.all("behind"); }
} return K; }
make_boolean(1); make_boolean(2).all("later");
function make_object(round: number) { class K {
    static has() { return #b in K; }
    static read() { return show(K.#b); }
    static readThis() { return show(this.#b); }
    static write(v: { v: number }) { K.#b = v; return "stored"; }
    static add() { (K as any).#b &&= { v: 6 }; return "added"; }
    static increment() { (K as any).#b &&= { v: 7 }; return "incremented"; }
    static or() { (K as any).#b ||= { v: 5 }; return "or"; }
    static nullish() { (K as any).#b ??= { v: 5 }; return "nullish"; }
    static pattern() { [K.#b] = [{ v: 5 }]; return "pattern"; }
    static call() { return (K as any).#b(); }
    static kind() { return typeof K.#b; }
    static all(when: string) {
      for (const door of ["has", "read", "readThis", "kind", "add", "increment", "or", "nullish", "pattern", "call", "has", "read"]) row("made object " + round + " " + when + " " + door, () => (K as any)[door]());
      row("made object " + round + " " + when + " write", () => K.write({ v: 5 }));
      row("made object " + round + " " + when + " has behind the write", () => K.has());
    }
    static { K.all("in a block ahead"); }
    static #b: { v: number } = { v: 5 };
    static { K.all("behind"); }
} return K; }
make_object(1); make_object(2).all("later");
function make_nullable(round: number) { class K {
    static has() { return #b in K; }
    static read() { return show(K.#b); }
    static readThis() { return show(this.#b); }
    static write(v: number | undefined) { K.#b = v; return "stored"; }
    static add() { (K as any).#b += 1; return "added"; }
    static increment() { (K as any).#b++; return "incremented"; }
    static or() { (K as any).#b ||= undefined; return "or"; }
    static nullish() { (K as any).#b ??= undefined; return "nullish"; }
    static pattern() { [K.#b] = [undefined]; return "pattern"; }
    static call() { return (K as any).#b(); }
    static kind() { return typeof K.#b; }
    static all(when: string) {
      for (const door of ["has", "read", "readThis", "kind", "add", "increment", "or", "nullish", "pattern", "call", "has", "read"]) row("made nullable " + round + " " + when + " " + door, () => (K as any)[door]());
      row("made nullable " + round + " " + when + " write", () => K.write(undefined));
      row("made nullable " + round + " " + when + " has behind the write", () => K.has());
    }
    static { K.all("in a block ahead"); }
    static #b: number | undefined = undefined;
    static { K.all("behind"); }
} return K; }
make_nullable(1); make_nullable(2).all("later");
function make_function(round: number) { class K {
    static has() { return #b in K; }
    static read() { return show(K.#b); }
    static readThis() { return show(this.#b); }
    static write(v: () => number) { K.#b = v; return "stored"; }
    static add() { (K as any).#b &&= () => 6; return "added"; }
    static increment() { (K as any).#b &&= () => 7; return "incremented"; }
    static or() { (K as any).#b ||= () => 5; return "or"; }
    static nullish() { (K as any).#b ??= () => 5; return "nullish"; }
    static pattern() { [K.#b] = [() => 5]; return "pattern"; }
    static call() { return (K as any).#b(); }
    static kind() { return typeof K.#b; }
    static all(when: string) {
      for (const door of ["has", "read", "readThis", "kind", "add", "increment", "or", "nullish", "pattern", "call", "has", "read"]) row("made function " + round + " " + when + " " + door, () => (K as any)[door]());
      row("made function " + round + " " + when + " write", () => K.write(() => 5));
      row("made function " + round + " " + when + " has behind the write", () => K.has());
    }
    static { K.all("in a block ahead"); }
    static #b: () => number = () => 5;
    static { K.all("behind"); }
} return K; }
make_function(1); make_function(2).all("later");
function make_anything(round: number) { class K {
    static has() { return #b in K; }
    static read() { return show(K.#b); }
    static readThis() { return show(this.#b); }
    static write(v: any) { K.#b = v; return "stored"; }
    static add() { (K as any).#b += 1; return "added"; }
    static increment() { (K as any).#b++; return "incremented"; }
    static or() { (K as any).#b ||= 5; return "or"; }
    static nullish() { (K as any).#b ??= 5; return "nullish"; }
    static pattern() { [K.#b] = [5]; return "pattern"; }
    static call() { return (K as any).#b(); }
    static kind() { return typeof K.#b; }
    static all(when: string) {
      for (const door of ["has", "read", "readThis", "kind", "add", "increment", "or", "nullish", "pattern", "call", "has", "read"]) row("made anything " + round + " " + when + " " + door, () => (K as any)[door]());
      row("made anything " + round + " " + when + " write", () => K.write(5));
      row("made anything " + round + " " + when + " has behind the write", () => K.has());
    }
    static { K.all("in a block ahead"); }
    static #b: any = 5;
    static { K.all("behind"); }
} return K; }
make_anything(1); make_anything(2).all("later");
