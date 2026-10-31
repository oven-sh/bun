type Listener = () => unknown;
type Held = Listener | Listener[] | undefined;
interface Events0 {
  [name: string]: Held;
  data: Held;
  readable: Held;
  end: Held;
}
interface Events1 {
  [name: string]: Held;
  readable: Held;
  error: Held;
  data: Held;
}
interface Events2 {
  [name: string]: Held;
  data: Held;
  end: Held;
}
interface Events3 {
  [name: string]: Held;
  data: Held;
  error: Held;
  close: Held;
  readable: Held;
  end: Held;
}
const key = (name: string): string => process.argv[9] ?? name;
function told(ask: () => unknown): unknown {
  try {
    return ask();
  } catch (error) {
    return "threw " + (error as Error).name;
  }
}
function one(value: any): string {
  if (typeof value === "function") {
    const answer = told(() => value());
    return "function " + (typeof answer === "string" ? answer : typeof answer) + (value.extra ? " extra" : "");
  }
  // A loop, not value.map(one): a method called on a value of unknown kind makes the compiler give up what it knows of the fields.
  if (Array.isArray(value)) {
    let text = "[";
    for (let at = 0; at < value.length; at++) text += (at ? ", " : "") + one(value[at]);
    return text + "]";
  }
  return value === null ? "null" : typeof value === "object" ? "{" + Object.keys(value).join() + "}" : typeof value + " " + String(value);
}
function described(events: any): string {
  return Object.keys(events).map(name => name + ": " + one(events[name])).join("; ");
}
{
  const made = (text: string) => () => text;
  const usual = made("usual");
  const again = () => made("other captures");
  const names: string[] = ["end","readable","data"].map(key);
  const room = (): Events0 => ({ data: undefined, readable: undefined, end: undefined });
  function add(events: Events0, name: string, value: Listener) {
    const existing = events[name];
    if (existing === undefined) events[name] = value;
    else events[name] = typeof existing === "function" ? [existing, value] : Array.isArray(existing) ? [...existing, value] : value;
  }
  let events = room();
  for (let turn = 0; turn < 3; turn++) {
    events = room();
    for (const name of names) add(events, name, usual);
    add(events, names[turn % names.length], usual);
  }
  console.log("scene 0 usual", described(events));
  
  events = room();
  told(() => add(events, names[0 % names.length], (([usual, usual]) as unknown as Listener)));
  told(() => add(events, names[1 % names.length], usual));
  
  console.log("scene 0 other 0", described(events));
}
{
  const word = key("usual");
  const usual = () => word;
  const again = () => usual;
  const names: string[] = ["error","readable","finish","drain","data"].map(key);
  const room = (): Events1 => ({ readable: undefined, error: undefined, data: undefined });
  function add(events: Events1, name: string, value: Listener) {
    const existing = events[name];
    if (existing === undefined) events[name] = value;
    else events[name] = typeof existing === "function" ? [existing, value] : Array.isArray(existing) ? [...existing, value] : value;
  }
  let events = room();
  for (let turn = 0; turn < 1; turn++) {
    events = room();
    for (const name of names) add(events, name, usual);
    add(events, names[turn % names.length], usual);
  }
  console.log("scene 1 usual", described(events));
  
  events = room();
  told(() => add(events, names[0 % names.length], (([() => "listed other"]) as unknown as Listener)));
  told(() => add(events, names[1 % names.length], usual));
  told(() => add(events, names[0 % names.length], usual));
  console.log("scene 1 other 0", described(events));
  events = room();
  told(() => add(events, names[1 % names.length], (([1, 2]) as unknown as Listener)));
  told(() => add(events, names[2 % names.length], usual));
  
  console.log("scene 1 other 1", described(events));
}
{
  const usual = () => "usual";
  const again = () => usual;
  const names: string[] = ["data","end","finish"].map(key);
  const room = (): Events2 => ({ data: undefined, end: undefined });
  function add(events: Events2, name: string, value: Listener) {
    const existing = events[name];
    if (existing === undefined) events[name] = value;
    else events[name] = typeof existing === "function" ? [existing, value] : Array.isArray(existing) ? [...existing, value] : value;
  }
  let events = room();
  for (let turn = 0; turn < 3000; turn++) {
    events = room();
    for (const name of names) add(events, name, usual);
    add(events, names[turn % names.length], usual);
  }
  console.log("scene 2 usual", described(events));
  
  events = room();
  told(() => add(events, names[0 % names.length], ((function () {
      return "another function";
    }) as unknown as Listener)));
  told(() => add(events, names[1 % names.length], usual));
  
  console.log("scene 2 other 0", described(events));
}
{
  const word = key("usual");
  const usual = () => word;
  const again = () => usual;
  const names: string[] = ["error","close","end","readable","data"].map(key);
  const room = (): Events3 => ({ data: undefined, error: undefined, close: undefined, readable: undefined, end: undefined });
  function add(events: Events3, name: string, value: Listener) {
    const existing = events[name];
    if (existing === undefined) events[name] = value;
    else events[name] = typeof existing === "function" ? [existing, value] : Array.isArray(existing) ? [...existing, value] : value;
  }
  let events = room();
  for (let turn = 0; turn < 300; turn++) {
    events = room();
    for (const name of names) add(events, name, usual);
    add(events, names[turn % names.length], usual);
  }
  console.log("scene 3 usual", described(events));
  

}
