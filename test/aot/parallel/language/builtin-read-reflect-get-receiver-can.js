// A prototype of a built-in, found under a computed name, is read by Reflect.get with a receiver.
// The program then replaces members of that prototype itself, under names out of a table. Its own stores must arrive: none of these members is locked on purpose.
const table = [["Error", "toString"], ["DisposableStack", "use"], ["FinalizationRegistry", "register"], ["WeakRef", "deref"]];
function attempt(action) {
  try {
    return action();
  } catch (error) {
    return "refused (" + error.constructor.name + ")";
  }
}
for (const [holder, name] of table) {
  const object = globalThis[holder].prototype;
  const was = object[name];
  console.log(holder, "mark", Reflect.get(object, "mark", object));
  const other = function other() {};
  const verdict = attempt(() => {
    object[name] = other;
    return object[name] === other ? "replaced" : "ignored";
  });
  attempt(() => {
    object[name] = was;
  });
  console.log(holder, name, verdict, object[name] === was ? "put back" : "not put back");
}
