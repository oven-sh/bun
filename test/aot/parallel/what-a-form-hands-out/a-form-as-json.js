// toJSON makes an ordinary object with a tag of its own: a name that stands once holds its value, one that stands more often an array.
const form = new FormData();
form.append("a", "1");
form.append("b", "2");
form.append("b", new File(["x"], "b.txt"));
form.append("b", "4");
form.append("0", "index");
const made = form.toJSON();
console.log(
  `${Reflect.ownKeys(made).map(String).join(" ")} ${Object.getPrototypeOf(made) === Object.prototype} ${made[Symbol.toStringTag]}`,
);
console.log(
  `${made.a} ${Array.isArray(made.b)} ${made.b.length} ${made.b[1] === form.getAll("b")[1]} ${made[0]} ${form.toJSON() === made}`,
);
console.log(
  `${JSON.stringify(Object.getOwnPropertyDescriptor(made, Symbol.toStringTag))} ${Reflect.ownKeys(new FormData().toJSON()).length}`,
);
for (const receiver of [undefined, {}, FormData.prototype]) {
  for (const member of ["toJSON", "entries", "get"]) {
    try {
      FormData.prototype[member].call(receiver, "a");
    } catch (error) {
      console.log(`${member}: ${error.name}`);
    }
  }
  try {
    Reflect.get(FormData.prototype, "length", receiver);
  } catch (error) {
    console.log(`length: ${error.name}`);
  }
}
