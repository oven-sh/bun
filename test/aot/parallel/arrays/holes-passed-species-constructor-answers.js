// concat, slice and map ask the species constructor of their receiver for an object and define on it the elements that the receiver has. An index at which the receiver has a hole is passed
// over. Here the constructor answers a list that already holds something at that index, which stays.
const answering = kept => ({
  [Symbol.species]: function () {
    return kept;
  },
});
const show = (name, made, kept) =>
  console.log(name, made === kept, 0 in made, made[0], made.length, JSON.stringify(made));
{
  const kept = [2, "text"];
  const list = [3, 1, 2];
  delete list[0];
  list.constructor = answering(kept);
  show("concat", list.concat(4), kept);
}
{
  const kept = [2, "text"];
  const list = [, 1, 2];
  list.constructor = answering(kept);
  show("slice", list.slice(0), kept);
}
{
  const kept = [2, "text"];
  const list = [, 1, 2];
  list.constructor = answering(kept);
  show(
    "map",
    list.map(each => each),
    kept,
  );
}
{
  const kept = [2, "text", "more"];
  const list = [, 1, 2];
  list.constructor = answering(kept);
  show(
    "filter",
    list.filter(() => true),
    kept,
  );
}
/* Output:
concat true true 2 4 [2,1,2,4]
slice true true 2 3 [2,1,2]
map true true 2 3 [2,1,2]
filter true true 1 3 [1,2,"more"]
*/
