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
Request add TypeError
Request replace TypeError
Request define TypeError
Request reparent TypeError
Response add TypeError
Response replace TypeError
Response define TypeError
Response reparent TypeError
Blob add TypeError
Blob replace TypeError
Blob define TypeError
Blob reparent TypeError
Headers add TypeError
Headers replace TypeError
Headers define TypeError
Headers reparent TypeError
URL add TypeError
URL replace TypeError
URL define TypeError
URL reparent TypeError
URLSearchParams add TypeError
URLSearchParams replace TypeError
URLSearchParams define TypeError
URLSearchParams reparent TypeError
*/
