// `Row` is what the checker says of the head. The second value that is stepped to is what a parse made.
const show = value => {
  try {
    return Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value) : typeof value === "function" ? "function" : String(value);
  } catch (error) {
    return "cannot be shown";
  }
};
const nameOf = error => error.constructor.name;
const attempt = run => {
  try {
    return show(run());
  } catch (error) {
    return nameOf(error);
  }
};
const attemptLater = async run => {
  try {
    return show(await run());
  } catch (error) {
    return nameOf(error);
  }
};
// Nobody can follow a value through a property of the global object.
function taken(value) {
  globalThis.handedOn = value;
  return globalThis.handedOn;
}
class Listed {
  id = 7;
  title = "listed";
  price = 700;
}
function use0() {
  const list = [{ id: 1, title: "one", price: 100 }, { id: 1, title: "one", price: 100 }, { id: 1, title: "one", price: 100 }];
  list[1] = taken(JSON.parse('{"id":2,"title":"two","price":200}'));
  function* steps() { yield* list; }
  let text = "";
  for (const held of steps()) text += show(`${held.id},${held.title},${held.price}`) + " ";
  return text;
}
function use1() {
  const list = [{ id: 1, title: "one", price: 100 }, { id: 1, title: "one", price: 100 }, { id: 1, title: "one", price: 100 }];
  list[1] = taken(JSON.parse('{"id":2,"title":"two","price":200}'));
  function* steps() { yield* list; }
  let text = "";
  for (const held of steps()) text += show(held.id + 1) + " ";
  return text;
}
function use2() {
  const list = [{ id: 1, title: "one", price: 100 }, { id: 1, title: "one", price: 100 }, { id: 1, title: "one", price: 100 }];
  list[1] = taken(JSON.parse('{"id":2,"title":"two","price":200}'));
  function* steps() { yield* list; }
  let text = "";
  for (const held of steps()) text += show(held.title.length) + " ";
  return text;
}
function use3() {
  const list = [{ id: 1, title: "one", price: 100 }, { id: 1, title: "one", price: 100 }, { id: 1, title: "one", price: 100 }];
  list[1] = taken(JSON.parse('{"id":2,"title":"two","price":200}'));
  function* steps() { yield* list; }
  let text = "";
  for (const held of steps()) text += show(held.price * 2) + " ";
  return text;
}
function use4() {
  const list = [{ id: 1, title: "one", price: 100 }, { id: 1, title: "one", price: 100 }, { id: 1, title: "one", price: 100 }];
  list[1] = taken(JSON.parse('{"id":2,"title":"two","price":200}'));
  function* steps() { yield* list; }
  let text = "";
  for (const held of steps()) text += show(Object.keys(held).join()) + " ";
  return text;
}
function use5() {
  const list = [{ id: 1, title: "one", price: 100 }, { id: 1, title: "one", price: 100 }, { id: 1, title: "one", price: 100 }];
  list[1] = taken(JSON.parse('{"id":2,"title":"two","price":200}'));
  function* steps() { yield* list; }
  let text = "";
  for (const held of steps()) text += show(JSON.stringify(held)) + " ";
  return text;
}
for (let round = 0; round < 3; round++) console.log(attempt(use0), attempt(use1), attempt(use2), attempt(use3), attempt(use4), attempt(use5));
