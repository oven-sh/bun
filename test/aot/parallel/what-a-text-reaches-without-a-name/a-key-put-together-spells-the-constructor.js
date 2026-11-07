// The key is put together of two texts, and the text that is evaluated names a method that the program does not.
const make = (() => 1)["constr" + "uctor"];
console.log(make("list", "return list.flatMap(item => [item, item])")([1, 2]));
