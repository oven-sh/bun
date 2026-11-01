// Flags: --aot-check=verify-each-pass
class Kind { tag = "c"; }
class Shelf {
  held: any;
  sort(value: Kind | unknown[] | string | null): any { if (value instanceof Array) { this.held = value; } else { this.held = value; } return "end"; }
}
const shelf = new Shelf();
for (const lie of [Object.create(Error.prototype), new Kind(), [1, 2], "ab", null, 5]) { console.log(shelf.sort(lie as any), typeof shelf.held, Array.isArray(shelf.held), shelf.held instanceof Kind); }
export {};
