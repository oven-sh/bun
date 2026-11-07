// Parsed by type keys in another order and extra keys stay as written.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  const parent = Object.getPrototypeOf(value);
  const mark = parent === Object.prototype ? "" : parent === null ? "without a prototype " : "with another prototype ";
  return mark + "{" + Object.entries(value).map(([key, held]) => JSON.stringify(key) + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

interface User {
  id: number;
  name: string;
  active: boolean;
}

function describe(user: User): string {
  return user.id + 1 + "/" + user.name.toUpperCase() + "/" + (user.active ? "on" : "off");
}
function rename(user: User, name: string): User {
  user.name = name;
  user.id += 0.5;
  return user;
}

const texts = [
  '{"id":1,"name":"a","active":true}',
  '{"active":false,"name":"b","id":2}',
  '{"name":"c","id":3,"active":true}',
  '{"extra":0,"id":4,"name":"d","active":true}',
  '{"id":5,"extra":[1],"name":"e","active":false}',
  '{"id":6,"name":"f","active":true,"extra":{"id":"x"}}',
  '{"z":1,"y":2,"active":true,"x":3,"name":"g","w":4,"id":7,"v":5}',
  '{"Id":0,"ID":0,"id":8,"name ":"","name":"h","active":true," active":false}',
  ' { "id" : 9 , "name" : "i" , "active" : false } ',
  '\n{\t"id":10,\r\n"name":"j","active":true}\n',
];

let warm = 0;
for (let i = 0; i < 2000; i++) warm += describe({ id: i, name: "n", active: i % 2 === 0 }).length;
console.log("2000 honest literals", warm);

for (const text of texts) {
  attempt(JSON.stringify(text), () => {
    const user = JSON.parse(text) as User;
    return [user, Object.keys(user), JSON.stringify(user), describe(user), typeof user.id, typeof user.name, typeof user.active, "extra" in user, Object.getPrototypeOf(user) === Object.prototype];
  });
  attempt("  then stored to", () => {
    const user = rename(JSON.parse(text) as User, "renamed");
    return [user, JSON.stringify(user), describe(user)];
  });
  attempt("  then copied", () => {
    const user = JSON.parse(text) as User;
    const copy: User = { ...user };
    const assigned: User = Object.assign({ id: 0, name: "", active: false }, user);
    return [copy, assigned, describe(copy), describe(assigned)];
  });
}
