// What the prototype of a class of the host has cannot be replaced, and what it inherits from stays. A new name is taken, as on the language's own prototypes.
const attempts = {
  add: C => {
    C.prototype.added = 1;
  },
  replace: C => {
    C.prototype.toString = function () {};
  },
  define: C => {
    Object.defineProperty(C.prototype, "added", { value: 1 });
  },
  reparent: C => {
    Object.setPrototypeOf(C.prototype, {});
  },
};
for (const C of [Request, Response, Blob, Headers, URL, URLSearchParams]) {
  for (const [kind, attempt] of Object.entries(attempts)) {
    try {
      attempt(C);
      console.log(C.name, kind, "was allowed");
    } catch (e) {
      console.log(C.name, kind, e.name);
    }
  }
}

/* Output:
Request add was allowed
Request replace TypeError
Request define was allowed
Request reparent TypeError
Response add was allowed
Response replace TypeError
Response define was allowed
Response reparent TypeError
Blob add was allowed
Blob replace TypeError
Blob define was allowed
Blob reparent TypeError
Headers add was allowed
Headers replace TypeError
Headers define was allowed
Headers reparent TypeError
URL add was allowed
URL replace TypeError
URL define was allowed
URL reparent TypeError
URLSearchParams add was allowed
URLSearchParams replace TypeError
URLSearchParams define was allowed
URLSearchParams reparent TypeError
*/
