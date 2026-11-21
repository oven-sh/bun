const words = async function* () {
  yield "first ";
  yield "second";
};

const request = new Request("http://localhost/", { method: "POST", body: words });
const copy = new Request(request);
console.log(copy.method, await copy.text());
