// An instance of a class of the program, with an accessor, a private field and an iterator, comes back as it went in.
class Shelf {
  #books = ["one", "two"];
  get size() {
    return this.#books.length;
  }
  *[Symbol.iterator]() {
    yield* this.#books;
  }
  toJSON() {
    return { books: this.#books };
  }
}
const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} }, data: new Shelf() });
const back = listener.data;
console.log(back instanceof Shelf, back.size, [...back].join(), JSON.stringify(back));
listener.stop(true);
console.log(Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } }).data);
process.exit(0);
