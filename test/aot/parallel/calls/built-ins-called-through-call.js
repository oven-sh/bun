// `m.call(o)` where m is a built-in: what it answers and what it makes are those of `o.m()`.
const log = [];
function t(name, f) {
  try {
    log.push(name + "=" + JSON.stringify(f()));
  } catch (e) {
    log.push(name + "!" + e.constructor.name);
  }
}
const kept = [];
function run(i) {
  const list = [i, 2, 3];
  const slice = Array.prototype.slice,
    push = Array.prototype.push,
    values = list[Symbol.iterator],
    has = Object.prototype.hasOwnProperty,
    str = Object.prototype.toString,
    keys = Array.prototype.keys,
    map = Array.prototype.map,
    join = Array.prototype.join;
  t("values", () => {
    const it = values.call(list);
    return [it.next().value, it.return === undefined, str.call(it)];
  });
  t("not a list", () => [...values.call({ length: 2, 0: "a", 1: "b" })]);
  t("text", () => [...values.call("ab")]);
  t("no this", () => values.call());
  t("null", () => values.call(null));
  t("slice", () => slice.call({ length: 2, 0: i, 1: "x" }, 1));
  t(
    "arguments",
    function () {
      return slice.call(arguments, 1);
    }.bind(null, 1, 2, 3),
  );
  t("push", () => {
    const o = { length: 0 };
    push.call(o, 1, 2);
    return o;
  });
  t("has", () => [has.call({ a: 1 }, "a"), has.call(list, "length"), has.call(list, 5)]);
  t("has by a key nobody knows", () => {
    const o = { a: 1, b: 2 };
    let found = 0;
    for (const key of ["a", "b", "c", "d"]) if (has.call(o, key)) found++;
    return found;
  });
  t("tag", () => [str.call(null), str.call([]), str.call(1), str.call(keys.call(list))]);
  t("map", () => map.call("abc", c => c + c));
  t("join", () => join.call({ length: 2, 0: 1, 1: 2 }, "-"));
  t("own member", () => {
    const it = keys.call(list);
    it.return = () => "own";
    return [it.return(), [...it].length];
  });
  t("kept", () => {
    const it = values.call(list);
    kept.push(it);
    return it.next().done;
  });
  t("call of call", () => Function.prototype.call.call(slice, list, 1));
  t("no function", () => Function.prototype.call.call(1));
  t("apply", () => slice.apply(list, [1]));
}
for (let i = 0; i < 4; i++) {
  log.length = 0;
  run(i);
}
console.log(log.join("\n"), kept.length, kept[0].next().value);
