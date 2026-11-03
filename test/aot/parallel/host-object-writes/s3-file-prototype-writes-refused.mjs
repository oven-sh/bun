const prototype = Object.getPrototypeOf(Bun.file("s3://bucket/key.json"));
const attempts = {
  add: () => {
    prototype.added = 1;
  },
  replace: () => {
    prototype.stat = function () {};
  },
  shadow: () => {
    prototype.json = function () {};
  },
  define: () => {
    Object.defineProperty(prototype, "added", { value: 1 });
  },
  remove: () => {
    delete prototype.presign;
  },
  reparent: () => {
    Object.setPrototypeOf(prototype, {});
  },
};
for (const [kind, attempt] of Object.entries(attempts)) {
  try {
    attempt();
    console.log(kind, "was allowed");
  } catch (e) {
    console.log(kind, e.name);
  }
}
console.log(Object.getPrototypeOf(prototype) === Blob.prototype, Reflect.ownKeys(prototype).length, prototype.json === Blob.prototype.json);

const file = Bun.file("s3://bucket/key.json");
file.json = () => "own";
console.log(file.json());

/* Output:
add TypeError
replace TypeError
shadow TypeError
define TypeError
remove TypeError
reparent TypeError
true 4 true
own
*/
