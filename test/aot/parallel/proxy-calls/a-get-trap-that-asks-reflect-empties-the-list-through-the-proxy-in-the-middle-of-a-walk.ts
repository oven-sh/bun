// Flags: --aot-validate
// The method of a call is looked up first, and the lookup may run code of the program that calls built-in functions itself. What the build expects of those calls says nothing of the method.
let step = 0;
let at = -1;
let damage: () => void = () => {};
function watched<T extends object>(inner: T): T {
  return new Proxy(inner, {
    get(target, key, receiver) {
      if (typeof key === "string" && key !== "length" && step++ === at) damage();
      return Reflect.get(target, key, receiver);
    },
  });
}
function* each(list: number[]) {
  yield* list;
}
for (const when of [8, 15, 2]) {
  const list = watched(Array.from({ length: 16 }, (_, index) => index));
  step = 0;
  at = when;
  damage = () => {
    while (list.length) list.pop();
  };
  const seen: number[] = [];
  for (const value of each(list)) seen.push(value);
  console.log(when, seen.join(), list.length);
}
