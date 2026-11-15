function answer(name, value) {
  return new Response("b", { status: 201, [name]: value });
}
function first(name, value) {
  return new Response("b", { [name]: value, status: 201 });
}
const written = () => new Response("b", { ["status"]: 202, ["status" + "Text"]: "Joined" });
for (let turn = 0; turn < 3; turn++) {
  for (const [name, value] of [["status", 210 + turn], ["statusText", "Computed"], ["headers", { a: "b" }], ["other", 1], [Symbol.iterator, 1], [0, 1], ["__proto__", { status: 299 }]]) {
    for (const make of [answer, first]) {
      const made = make(name, value);
      console.log(made.status, JSON.stringify(made.statusText), [...made.headers].join("|"));
    }
  }
  console.log(written().status, written().statusText);
}
