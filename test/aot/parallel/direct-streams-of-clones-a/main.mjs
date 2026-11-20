async function* words() {
  yield "first ";
  yield "second";
}

const response = new Response(words(), { status: 201, headers: { "x-one": "two" } });
const copy = response.clone();
console.log(copy.status, copy.headers.get("x-one"));
console.log(await copy.text());
console.log(await response.text());
