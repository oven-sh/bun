// What the constructor of Request runs of its options: conversions and getters of the headers, iterators of the headers and of their pairs, the async iterator of the body. And what it refuses.
let ran = 0;
const show = request => [...request.headers].map(pair => pair.join("=")).join();
console.log(
  show(
    new Request("http://localhost/", {
      headers: {
        a: {
          toString() {
            ran += 1;
            return "one";
          },
        },
        get b() {
          ran += 10;
          return "two";
        },
      },
    }),
  ),
);
console.log(
  show(
    new Request("http://localhost/", {
      headers: {
        *[Symbol.iterator]() {
          ran += 100;
          yield ["a", "one"];
          yield {
            *[Symbol.iterator]() {
              ran += 1000;
              yield "b";
              yield "two";
            },
          };
        },
      },
    }),
  ),
);
console.log(
  show(
    new Request("http://localhost/", {
      headers: [
        [
          "a",
          {
            toString() {
              ran += 10000;
              return "one";
            },
          },
        ],
      ],
    }),
  ),
);
console.log(
  show(
    new Request({
      url: "http://localhost/",
      headers: {
        *[Symbol.iterator]() {
          ran += 100000;
          yield ["a", "one"];
        },
      },
    }),
  ),
);
console.log(
  new Request("http://localhost/", {
    method: {
      toString() {
        ran += 1000000;
        return "POST";
      },
    },
  }).method,
);
const body = {
  async *[Symbol.asyncIterator]() {
    ran += 10000000;
    yield "from ";
    yield "an iterable";
  },
};
console.log(await new Request("http://localhost/", { method: "POST", body }).text());
console.log(await new Request({ url: "http://localhost/", method: "POST", body }).text());
console.log(
  await new Request("http://localhost/", {
    method: "POST",
    get body() {
      ran += 100000000;
      return "from a getter";
    },
  }).text(),
);
for (const init of [
  { headers: 1 },
  { headers: [1] },
  { headers: [["a"]] },
  { headers: { a: Symbol("x") } },
  { method: Symbol("x") },
  { signal: {} },
  { headers: { "bad name": "x" } },
]) {
  try {
    console.log(new Request("http://localhost/", init).method);
  } catch (error) {
    console.log(error.name, error.code, String(error.message).slice(0, 90));
  }
}
console.log(ran);
