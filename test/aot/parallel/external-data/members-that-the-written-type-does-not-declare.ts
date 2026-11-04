// Texts have members that the written type does not declare, in front of, between and behind the declared ones, again and again in one form and then in another: every member is there, in the order of the text.
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a layout that parsers make
type User = { id: number; name: string };
function one(text: string) { return JSON.parse(text) as User; }
function many(text: string) { return JSON.parse(text) as User[]; }
function show(u: User) { return JSON.stringify(u) + " " + Object.keys(u).join(); }
const forms = [
  (i: number) => `{"id":${i},"name":"n","extra":${i}}`,
  (i: number) => `{"extra":${i},"id":${i},"name":"n"}`,
  (i: number) => `{"id":${i},"a":1,"b":[2],"name":"n","c":{"d":3},"e":null}`,
  (i: number) => `{"id":${i},"name":"n","0":"index","1":"index"}`,
  (i: number) => `{"id":${i},"name":"n","a1":1,"a2":2,"a3":3,"a4":4,"a5":5,"a6":6,"a7":7,"a8":8,"a9":9,"a10":10}`,
];
for (const form of forms) {
  let last = "";
  for (let i = 0; i < 40; i++) last = show(one(form(i)));
  console.log(last);
  const texts: string[] = [];
  for (let i = 0; i < 40; i++) texts.push(form(i));
  const list = many("[" + texts.join(",") + "]");
  console.log(list.length, show(list[0]), show(list[39]));
}
const mixed = many("[" + forms.map((form, i) => form(i)).join(",") + "]");
for (const user of mixed) console.log(show(user));
