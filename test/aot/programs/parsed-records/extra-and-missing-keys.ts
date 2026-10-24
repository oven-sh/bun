const leak = new Function("value", process.argv.length > 99 ? "" : "return value");
function parse(text: string, reviver?: any): any {
  return JSON.parse(text, reviver);
}
interface User { id: number; name: string; email?: string }
function greet(user: User): string {
  return `${user.id}:${user.name}:${user.email}`;
}
function show(text: string) {
  const value = parse(text);
  console.log(greet(value), Object.keys(value).join(), JSON.stringify(value), "email" in value, Object.hasOwn(value, "name"), value.extra);
}
leak({ id: 0, name: "", email: "" } satisfies User);
console.log(greet({ id: 1, name: "a" }));
for (let round = 0; round < 3; round++) {
  show('{"id":1,"name":"a"}');
  show('{"id":1,"name":"a","email":"a@b"}');
  show('{"id":1,"name":"a","extra":true}');
  show('{"extra":true,"id":1,"name":"a"}');
  show('{"id":1,"extra":[1,2],"name":"a","email":"e"}');
  show('{"id":1}');
  show('{"name":"a"}');
  show('{"email":"e"}');
  show("{}");
  show('{"id":1,"name":"a","0":"zero","10":"ten"}');
  show('{"1":"one","id":1,"name":"a"}');
}
export {};
