"use strict";
interface Entry {
  id: number;
  secret: string;
  note: string;
}
function build(): Entry {
  return Object.defineProperty(
    Object.defineProperty({ note: "n" }, "secret", { value: "s", enumerable: false, writable: true, configurable: true }),
    "id",
    { value: 1, enumerable: true, writable: false, configurable: false },
  ) as unknown as Entry;
}
function show(entry: Entry) {
  return entry.id + entry.secret + entry.note + ":" + Object.keys(entry).join() + ":" + JSON.stringify(entry);
}
const entry = build();
console.log(show(entry));
const failures: string[] = [];
for (const attempt of [() => void (entry.id = 2), () => void delete (entry as { id?: number }).id, () => void (entry.secret = "t")]) {
  try {
    attempt();
    failures.push("fine");
  } catch (error) {
    failures.push((error as Error).constructor.name);
  }
}
console.log(failures.join(), show(entry), Object.propertyIsEnumerable.call(entry, "secret"));
