// `{} as Pick<T, K>`: what pick() returns never has the layout that its type names, so the check of the result is decided when the program is built, and all of the caller goes on by name.
function pick<T extends object, K extends keyof T>(source: T, ...keys: K[]): Pick<T, K> {
  const picked = {} as Pick<T, K>;
  for (const key of keys) picked[key] = source[key];
  return picked;
}
const person = { name: "Ann", age: 40, email: "a@b.c", city: "Rome" };
function brief(i: number): string {
  const picked = pick(person, "name", "age");
  let text = "";
  for (let k = 0; k < (i & 3); k++) text += picked.name + picked.age;
  return text + Object.keys(picked).join() + ("email" in picked);
}
for (let i = 0; i < 6; i++) console.log(brief(i));
