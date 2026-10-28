// Static private fields of every type are read, tested with `in` and written before their initializer has run, in classes at the top level.
declare const console: { log(...a: unknown[]): void };
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown): void { console.log(label + ": " + said(f)); }
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));
function show(v: unknown) { return typeof v === "function" || typeof v === "object" ? typeof v : String(v); }
class K_number {
    static has() { return #b in K_number; }
    static read() { return show(K_number.#b); }
    static readThis() { return show(this.#b); }
    static write(v: number) { K_number.#b = v; return "stored"; }
    static add() { (K_number as any).#b += 1; return "added"; }
    static increment() { (K_number as any).#b++; return "incremented"; }
    static or() { (K_number as any).#b ||= 5; return "or"; }
    static nullish() { (K_number as any).#b ??= 5; return "nullish"; }
    static pattern() { [K_number.#b] = [5]; return "pattern"; }
    static call() { return (K_number as any).#b(); }
    static kind() { return typeof K_number.#b; }
    static all(when: string) {
      for (const door of ["has", "read", "readThis", "kind", "add", "increment", "or", "nullish", "pattern", "call", "has", "read"]) row("top number" + " " + when + " " + door, () => (K_number as any)[door]());
      row("top number" + " " + when + " write", () => K_number.write(5));
      row("top number" + " " + when + " has behind the write", () => K_number.has());
    }
    static { K_number.all("in a block ahead"); }
    static a = (K_number.all("in an initializer ahead"), 1);
    static #b: number = (K_number.all("in its own initializer"), 5);
    static { K_number.all("behind"); }
}
class K_string {
    static has() { return #b in K_string; }
    static read() { return show(K_string.#b); }
    static readThis() { return show(this.#b); }
    static write(v: string) { K_string.#b = v; return "stored"; }
    static add() { (K_string as any).#b += "x"; return "added"; }
    static increment() { (K_string as any).#b += "y"; return "incremented"; }
    static or() { (K_string as any).#b ||= "five"; return "or"; }
    static nullish() { (K_string as any).#b ??= "five"; return "nullish"; }
    static pattern() { [K_string.#b] = ["five"]; return "pattern"; }
    static call() { return (K_string as any).#b(); }
    static kind() { return typeof K_string.#b; }
    static all(when: string) {
      for (const door of ["has", "read", "readThis", "kind", "add", "increment", "or", "nullish", "pattern", "call", "has", "read"]) row("top string" + " " + when + " " + door, () => (K_string as any)[door]());
      row("top string" + " " + when + " write", () => K_string.write("five"));
      row("top string" + " " + when + " has behind the write", () => K_string.has());
    }
    static { K_string.all("in a block ahead"); }
    static a = (K_string.all("in an initializer ahead"), 1);
    static #b: string = (K_string.all("in its own initializer"), "five");
    static { K_string.all("behind"); }
}
class K_boolean {
    static has() { return #b in K_boolean; }
    static read() { return show(K_boolean.#b); }
    static readThis() { return show(this.#b); }
    static write(v: boolean) { K_boolean.#b = v; return "stored"; }
    static add() { (K_boolean as any).#b &&= false; return "added"; }
    static increment() { (K_boolean as any).#b ||= true; return "incremented"; }
    static or() { (K_boolean as any).#b ||= true; return "or"; }
    static nullish() { (K_boolean as any).#b ??= true; return "nullish"; }
    static pattern() { [K_boolean.#b] = [true]; return "pattern"; }
    static call() { return (K_boolean as any).#b(); }
    static kind() { return typeof K_boolean.#b; }
    static all(when: string) {
      for (const door of ["has", "read", "readThis", "kind", "add", "increment", "or", "nullish", "pattern", "call", "has", "read"]) row("top boolean" + " " + when + " " + door, () => (K_boolean as any)[door]());
      row("top boolean" + " " + when + " write", () => K_boolean.write(true));
      row("top boolean" + " " + when + " has behind the write", () => K_boolean.has());
    }
    static { K_boolean.all("in a block ahead"); }
    static a = (K_boolean.all("in an initializer ahead"), 1);
    static #b: boolean = (K_boolean.all("in its own initializer"), true);
    static { K_boolean.all("behind"); }
}
class K_object {
    static has() { return #b in K_object; }
    static read() { return show(K_object.#b); }
    static readThis() { return show(this.#b); }
    static write(v: { v: number }) { K_object.#b = v; return "stored"; }
    static add() { (K_object as any).#b &&= { v: 6 }; return "added"; }
    static increment() { (K_object as any).#b &&= { v: 7 }; return "incremented"; }
    static or() { (K_object as any).#b ||= { v: 5 }; return "or"; }
    static nullish() { (K_object as any).#b ??= { v: 5 }; return "nullish"; }
    static pattern() { [K_object.#b] = [{ v: 5 }]; return "pattern"; }
    static call() { return (K_object as any).#b(); }
    static kind() { return typeof K_object.#b; }
    static all(when: string) {
      for (const door of ["has", "read", "readThis", "kind", "add", "increment", "or", "nullish", "pattern", "call", "has", "read"]) row("top object" + " " + when + " " + door, () => (K_object as any)[door]());
      row("top object" + " " + when + " write", () => K_object.write({ v: 5 }));
      row("top object" + " " + when + " has behind the write", () => K_object.has());
    }
    static { K_object.all("in a block ahead"); }
    static a = (K_object.all("in an initializer ahead"), 1);
    static #b: { v: number } = (K_object.all("in its own initializer"), { v: 5 });
    static { K_object.all("behind"); }
}
class K_nullable {
    static has() { return #b in K_nullable; }
    static read() { return show(K_nullable.#b); }
    static readThis() { return show(this.#b); }
    static write(v: number | undefined) { K_nullable.#b = v; return "stored"; }
    static add() { (K_nullable as any).#b += 1; return "added"; }
    static increment() { (K_nullable as any).#b++; return "incremented"; }
    static or() { (K_nullable as any).#b ||= undefined; return "or"; }
    static nullish() { (K_nullable as any).#b ??= undefined; return "nullish"; }
    static pattern() { [K_nullable.#b] = [undefined]; return "pattern"; }
    static call() { return (K_nullable as any).#b(); }
    static kind() { return typeof K_nullable.#b; }
    static all(when: string) {
      for (const door of ["has", "read", "readThis", "kind", "add", "increment", "or", "nullish", "pattern", "call", "has", "read"]) row("top nullable" + " " + when + " " + door, () => (K_nullable as any)[door]());
      row("top nullable" + " " + when + " write", () => K_nullable.write(undefined));
      row("top nullable" + " " + when + " has behind the write", () => K_nullable.has());
    }
    static { K_nullable.all("in a block ahead"); }
    static a = (K_nullable.all("in an initializer ahead"), 1);
    static #b: number | undefined = (K_nullable.all("in its own initializer"), undefined);
    static { K_nullable.all("behind"); }
}
class K_function {
    static has() { return #b in K_function; }
    static read() { return show(K_function.#b); }
    static readThis() { return show(this.#b); }
    static write(v: () => number) { K_function.#b = v; return "stored"; }
    static add() { (K_function as any).#b &&= () => 6; return "added"; }
    static increment() { (K_function as any).#b &&= () => 7; return "incremented"; }
    static or() { (K_function as any).#b ||= () => 5; return "or"; }
    static nullish() { (K_function as any).#b ??= () => 5; return "nullish"; }
    static pattern() { [K_function.#b] = [() => 5]; return "pattern"; }
    static call() { return (K_function as any).#b(); }
    static kind() { return typeof K_function.#b; }
    static all(when: string) {
      for (const door of ["has", "read", "readThis", "kind", "add", "increment", "or", "nullish", "pattern", "call", "has", "read"]) row("top function" + " " + when + " " + door, () => (K_function as any)[door]());
      row("top function" + " " + when + " write", () => K_function.write(() => 5));
      row("top function" + " " + when + " has behind the write", () => K_function.has());
    }
    static { K_function.all("in a block ahead"); }
    static a = (K_function.all("in an initializer ahead"), 1);
    static #b: () => number = (K_function.all("in its own initializer"), () => 5);
    static { K_function.all("behind"); }
}
class K_anything {
    static has() { return #b in K_anything; }
    static read() { return show(K_anything.#b); }
    static readThis() { return show(this.#b); }
    static write(v: any) { K_anything.#b = v; return "stored"; }
    static add() { (K_anything as any).#b += 1; return "added"; }
    static increment() { (K_anything as any).#b++; return "incremented"; }
    static or() { (K_anything as any).#b ||= 5; return "or"; }
    static nullish() { (K_anything as any).#b ??= 5; return "nullish"; }
    static pattern() { [K_anything.#b] = [5]; return "pattern"; }
    static call() { return (K_anything as any).#b(); }
    static kind() { return typeof K_anything.#b; }
    static all(when: string) {
      for (const door of ["has", "read", "readThis", "kind", "add", "increment", "or", "nullish", "pattern", "call", "has", "read"]) row("top anything" + " " + when + " " + door, () => (K_anything as any)[door]());
      row("top anything" + " " + when + " write", () => K_anything.write(5));
      row("top anything" + " " + when + " has behind the write", () => K_anything.has());
    }
    static { K_anything.all("in a block ahead"); }
    static a = (K_anything.all("in an initializer ahead"), 1);
    static #b: any = (K_anything.all("in its own initializer"), 5);
    static { K_anything.all("behind"); }
}
