import { test } from "bun:test";
import { callMark, markOf } from "./app.js";

function places() {
  return [
    ["Function.prototype", Function.prototype],
    ["Array.prototype", Array.prototype],
    ["parsed", JSON.parse("{}")],
  ];
}

// Several objects meet in one list, so the store names none of them.
test("one store marks every object of a list", () => {
  const uses = () => [markOf(() => 1), markOf([]), typeof markOf(places), callMark(() => 1), callMark([])].join(" ");
  console.log("as made:", uses());
  for (const [, place] of places()) Reflect.set(place, "planted", () => "here");
  console.log("planted:", uses());
  for (const [, place] of places()) Reflect.deleteProperty(place, "planted");
  console.log("taken away:", uses());
});
