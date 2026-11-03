console.log(/(?<n>a)|(?<n>b)/.exec("b").groups.n, /(?i:a)b/.test("Ab"), /[[a-c]--[b]]/v.test("b"));
console.log(
  /\1/.test("\x01"),
  /\8/.test("8"),
  /a{,5}/.test("a{,5}"),
  /\k<a>/.test("k<a>"),
  /(?=a)*/.test(""),
  /\p{L}/u.test("a"),
  /\u{10}/u.test("\x10"),
);
