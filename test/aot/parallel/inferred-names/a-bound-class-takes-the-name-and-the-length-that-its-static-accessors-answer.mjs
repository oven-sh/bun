// A class is a function. A static accessor called "name" or "length" takes the place of the property that every function has,
// and a bound class takes its name and its length from what that accessor answers when bind() runs: also where the accessor
// stands in front of a member under a key in brackets, or under such a key itself, and where the class got another name later.
const key = ["mem", "ber"][0] + ["mem", "ber"][1];
const lengthKey = ["len", "gth"].join("");
const nameKey = ["na", "me"].join("");
const classes = {
  "a getter called length in front of a member under a key in brackets": () => class C { constructor(a, b) {} static get length() { return 9; } [key]() {} },
  "a getter under the key length in brackets": () => class C { constructor(a, b) {} static get [lengthKey]() { return 9; } },
  "a getter called length and no key in brackets": () => class C { constructor(a, b) {} static get length() { return 9; } },
  "a setter called length in front of a member under a key in brackets": () => class C { constructor(a, b) {} static set length(value) {} [key]() {} },
  "a getter called name in front of a member under a key in brackets": () => class C { constructor(a, b) {} static get name() { return "custom"; } [key]() {} },
  "a getter under the key name in brackets": () => class C { constructor(a, b) {} static get [nameKey]() { return "custom"; } },
  "a getter called name and no key in brackets": () => class C { constructor(a, b) {} static get name() { return "custom"; } },
  "a setter called name in front of a member under a key in brackets": () => class C { constructor(a, b) {} static set name(value) {} [key]() {} },
  "getters called name and length in front of a member under a key in brackets": () => class C { constructor(a, b) {} static get name() { return "custom"; } static get length() { return 9; } [key]() {} },
  "a member under a key in brackets and nothing called name or length": () => class C { constructor(a, b) {} static [key]() {} },
  "a class under a key in brackets with a getter called length": () => ({ [key]: class { constructor(a, b) {} static get length() { return 9; } } })[key],
  "a class under a key in brackets with a getter called length in front of a member under a key in brackets": () => ({ [key]: class { constructor(a, b) {} static get length() { return 9; } [key]() {} } })[key],
};
const say = (what, C) => {
  const bound = C.bind(null, 1);
  console.log(what + ":", JSON.stringify(bound.name), bound.length, JSON.stringify(bound.bind(null).name));
};
for (const [what, make] of Object.entries(classes)) {
  say(what, make());
  const renamed = make();
  Object.defineProperty(renamed, "name", { value: "renamed" });
  say(what + ", and another name later", renamed);
}
