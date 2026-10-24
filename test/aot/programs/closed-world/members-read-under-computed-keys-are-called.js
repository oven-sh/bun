// A member of a built-in prototype that is read under a computed key is only held by the read. Each way of calling it afterwards has to find the code behind it in the executable:
// member.call(o), member.apply(o, []), Reflect.apply, a bound copy, a plain call of a stored copy, a callback handed to another built-in, a getter and a constructor found the same way.
const names = JSON.parse(process.env.NAMES ?? '["toSorted","map","filter","reduce","lastIndexOf","flat","includes","findLast","flatMap","toSpliced"]');
const list = [3, 1, [2]];
const byNumber = (a, b) => (b === undefined || typeof b !== "number" || typeof a !== "number" ? a : a - b);
function show(label, f) {
  let said;
  try {
    said = JSON.stringify(f());
  } catch (error) {
    said = "threw " + error.constructor.name;
  }
  console.log(label + ": " + said);
}
for (const name of names) {
  const member = list[name];
  show(name + " call", () => member.call(list, byNumber));
  show(name + " apply", () => member.apply(list, [byNumber]));
  show(name + " Reflect.apply", () => Reflect.apply(member, list, [byNumber]));
  show(name + " bound", () => member.bind(list)(byNumber));
  show(name + " computed call", () => list[name](byNumber));
  const table = { run: member, length: 2, 0: 5, 1: 4 };
  show(name + " under another name", () => table.run(byNumber));
}

const texts = JSON.parse(process.env.TEXTS ?? '["padStart","replaceAll","split","at","normalize","localeCompare"]');
for (const name of texts) {
  const member = "abc"[name];
  show(name + " call", () => member.call("abc", 5, "x"));
}

const holders = { Map, Set, Promise, JSON, Math, Object, Array };
const picked = JSON.parse(process.env.PICKED ?? '[["Map","groupBy"],["Object","fromEntries"],["Array","from"],["JSON","stringify"],["Math","hypot"],["Object","groupBy"]]');
for (const [holder, name] of picked) {
  const member = holders[holder][name];
  show(holder + "." + name, () => {
    const made = member([[3, 4]], x => x.length);
    return made instanceof Map ? [...made] : made;
  });
}

const callbacks = JSON.parse(process.env.CALLBACKS ?? '["isArray","of"]');
for (const name of callbacks) show("callback " + name, () => [[1], 2].map(Array[name]));

const constructed = JSON.parse(process.env.CONSTRUCTED ?? '["Map","Set","Array"]');
for (const name of constructed) show("new " + name, () => [...new holders[name]([[1, 2]])]);
show("constructor of a value", () => new list.constructor(2).length + new (new Map().constructor)([[1, 2]]).size);

const descriptor = Object.getOwnPropertyDescriptor(Map.prototype, JSON.parse(process.env.GETTER ?? '"size"'));
show("getter", () => descriptor.get.call(new Map([[1, 2]])));

const then = Promise.prototype[JSON.parse(process.env.THEN ?? '"then"')];
await then.call(Promise.resolve(7), value => show("then", () => value));
