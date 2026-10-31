// Functions declared in blocks, branches, loops, switch cases, try blocks and behind labels of a sloppy CommonJS file, read outside of them. Plain Bun prints another output.
function show(label, f) {
  try {
    console.log(label, f());
  } catch (e) {
    console.log(label, e.constructor.name + ": " + e.message);
  }
}
function outer() {
  return "outer";
}
{
  function outer() {
    return "inner";
  }
}
show("same name as a function outside", () => outer());
show("before its block", () => typeof later);
{
  function later() {}
}
show("behind its block", () => typeof later);
show("in a function", () => {
  {
    function f() {
      return 1;
    }
  }
  return typeof f;
});
show("in an if", () => {
  if (true) {
    function g() {
      return 1;
    }
  }
  return typeof g;
});
show("in a branch not taken", () => {
  if (false) {
    function h() {}
  }
  return typeof h;
});
show("beside a let of that name", () => {
  let k = 1;
  {
    function k() {}
  }
  return typeof k;
});
show("in a switch", () => {
  switch (1) {
    case 1:
      function s() {}
  }
  return typeof s;
});
show("a parameter of that name", () =>
  (function (p) {
    {
      function p() {}
    }
    return typeof p;
  })(1),
);
show("on the global object", () => typeof globalThis.later);
show("name", () => {
  {
    function named() {}
  }
  return named.name;
});
show("in a loop", () => {
  for (let i = 0; i < 1; i++) {
    function l() {}
  }
  return typeof l;
});
show("in a try", () => {
  try {
    function t() {}
  } finally {
  }
  return typeof t;
});
show("labelled", () => {
  x: function lab() {}
  return typeof lab;
});
/* Output:
same name as a function outside inner
before its block undefined
behind its block function
in a function function
in an if function
in a branch not taken undefined
beside a let of that name number
in a switch function
a parameter of that name number
on the global object undefined
name named
in a loop function
in a try function
labelled function
*/
