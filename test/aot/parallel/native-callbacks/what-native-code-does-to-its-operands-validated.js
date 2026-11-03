// Flags: --aot-validate
// Two things that native code does to its operands, each in a block of its own. The validating executable holds every native call to what the table of built-ins says of it.
// A built-in that calls a member of an operand and hands on what it answers finds Object.prototype.valueOf there, which answers the operand itself.
{
  function viaToJSON() {
    const holder = { toISOString: Object.prototype.valueOf, tag: 1 };
    const result = Date.prototype.toJSON.call(holder);
    result.tag = 2;
    return [result === holder, holder.tag];
  }
  function viaToLocaleString() {
    const holder = { toString: Object.prototype.valueOf, tag: 1 };
    const result = holder.toLocaleString();
    result.tag = 2;
    return [result === holder, holder.tag];
  }
  function viaArrayToString() {
    const holder = { join: Object.prototype.valueOf, tag: 1 };
    const result = Array.prototype.toString.call(holder);
    result.tag = 2;
    return [result === holder, holder.tag];
  }
  function viaText(symbol, call) {
    const holder = { [symbol]: Object.prototype.valueOf, tag: 1 };
    const result = call(holder);
    result.tag = 2;
    return [result === holder, holder.tag];
  }
  function viaStringify() {
    const holder = { toJSON: Date.prototype.toJSON, toISOString: Object.prototype.valueOf, tag: 1 };
    return JSON.stringify({ holder });
  }
  function made(tag) {
    const holder = { toISOString: Object.prototype.valueOf, tag };
    return Date.prototype.toJSON.call(holder);
  }

  console.log(viaToJSON().join(), viaToLocaleString().join(), viaArrayToString().join());
  console.log(
    viaText(Symbol.split, holder => "a-b".split(holder)).join(),
    viaText(Symbol.replace, holder => "a-b".replace(holder, "c")).join(),
    viaText(Symbol.replace, holder => "a-b".replaceAll(holder, "c")).join(),
    viaText(Symbol.match, holder => "a-b".match(holder)).join(),
    viaText(Symbol.matchAll, holder => "a-b".matchAll(holder)).join(),
    viaText(Symbol.search, holder => "a-b".search(holder)).join(),
  );
  console.log(viaStringify());
  const kept = [];
  for (let index = 0; index < 500; index++) kept.push(made(index));
  let sum = 0;
  for (const each of kept) sum += each.tag;
  console.log(kept.length, sum, kept[0] === kept[1]);

}
// An object with an accessor under an index becomes the prototype of a prototype of an object that has elements, by each way to link two objects. Lists of the program go on as they were.
{
  function scene(link) {
    const stored = [];
    const above = {};
    const below = { __proto__: above, 0: 2 };
    below[0]++;
    const list = [1, 2, 3];
    const fractions = [1.5, 2.5];
    let sum = list[0] + fractions[0];
    link(above, { get 1() { return "from the getter"; }, set 1(value) { stored.push(value); } });
    sum += list[1] + fractions[1];
    below[1] = 5;
    below[2] = 6;
    list[4] = 7;
    list.push(8);
    fractions[1] = 9.25;
    return [sum, below[0], below[1], below[2], Object.keys(below).join(), stored.join(), list.join(), list.length, fractions.join()].join(" ");
  }
  console.log(scene((object, prototype) => Object.setPrototypeOf(object, prototype)));
  console.log(scene((object, prototype) => Reflect.setPrototypeOf(object, prototype)));
  console.log(scene((object, prototype) => { object.__proto__ = prototype; }));
  console.log(scene((object, prototype) => Object.defineProperties(object, Object.getOwnPropertyDescriptors(prototype))));

}
