// slice, splice and concat ask the species constructor of their receiver for an object, define the elements on it and store a length. Here the constructor answers an object that the program has had for long.
{
  const literal = { la: { qb: 3 }, lb: 4 };
  const source = ["s", "t"];
  source.constructor = { [Symbol.species]: function () { return literal; } };
  console.log(String(source.slice(0)));
  let others = 0;
  for (const key of Object.keys(literal)) {
    if (key === "la") console.log("la");
    else if (key === "lb") console.log("lb");
    else console.log("another key", key, ++others);
  }
  console.log(others, literal.length === undefined ? "no length" : "a length", literal[0] === undefined ? "no element" : "an element");
}
{
  const literal = { la: { qb: 3 }, lb: 4 };
  const source = ["s", "t"];
  source.constructor = { [Symbol.species]: function () { return literal; } };
  console.log(String(source.splice(0, 1)));
  const table = { la: 1, lb: 2 };
  console.log(Object.keys(literal).map(key => table[key]).join());
  console.log(Object.getOwnPropertyNames(literal).filter(name => name !== "la" && name !== "lb").length, Reflect.ownKeys(literal).filter(name => name !== "la" && name !== "lb").length);
}
{
  const literal = { la: { qb: 3 }, lb: 4 };
  const source = ["s", "t"];
  source.constructor = { [Symbol.species]: function () { return literal; } };
  console.log(String(source.concat(["u"], "v")));
  let others = 0;
  for (const key of Object.keys(literal)) if (key !== "la" && key !== "lb") others++;
  console.log(others, typeof literal.length);
}
{
  let seen = "nothing";
  const literal = { la: 1, set length(value) { seen = "the setter was given " + value; } };
  const source = ["s", "t"];
  source.constructor = { [Symbol.species]: function () { return literal; } };
  console.log(String(source.slice(0)));
  console.log(seen, Object.keys(literal).join("+"));
}
{
  let seen = "nothing";
  class Inheriting { ga = 1; set length(value) { seen = "the inherited setter was given " + value; } }
  const instance = new Inheriting();
  const source = ["s", "t"];
  source.constructor = { [Symbol.species]: function () { return instance; } };
  console.log(String(source.splice(0, 1)));
  console.log(seen, Object.keys(instance).join("+"));
}
{
  const literal = { length: "text", la: 1 };
  const shout = object => typeof object.length === "string" ? object.length.toUpperCase() : "a " + typeof object.length + " " + (object.length + 1);
  console.log(shout(literal));
  const source = ["s", "t"];
  source.constructor = { [Symbol.species]: function () { return literal; } };
  console.log(String(source.slice(0)));
  console.log(shout(literal), literal.length);
}
