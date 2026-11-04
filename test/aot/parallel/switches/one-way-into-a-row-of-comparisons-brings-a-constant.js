// One way into the first comparison brings `undefined`, which decides it; the other brings whatever the field holds.
function classify(flag, given, list) {
  let found = -1;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "ipc") { found = i; break; }
  }
  const code = flag ? given.code : undefined;
  if (code === "a" || code === "b" || code === "c" || code === "d" || code === "e") return found + 1;
  throw given;
}
function tell(flag, given, list) {
  try {
    return classify(flag, given, list);
  } catch (thrown) {
    return "thrown " + thrown.code;
  }
}
console.log(tell(true, { code: "c" }, ["x", "ipc"]), tell(true, { code: "a" }, []), tell(true, { code: "e" }, ["ipc"]));
console.log(tell(true, { code: "f" }, ["x"]), tell(false, { code: "c" }, ["x"]), tell(true, { code: 5 }, "ipc"), tell(0, { code: "a" }, []));
