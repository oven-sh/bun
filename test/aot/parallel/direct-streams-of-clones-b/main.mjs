const words = {
  async *[Symbol.asyncIterator]() {
    yield "first ";
    await 1;
    yield "second";
  },
};

const request = new Request("http://localhost/", { method: "POST", body: words });
const copy = request.clone();
console.log(copy.method, await copy.text());
console.log(await request.text());
