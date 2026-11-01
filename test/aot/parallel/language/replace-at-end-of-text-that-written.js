// `"quire".replace(/^/, "re")` is known at the build. What stands beside it is not, and answers the same as ever.
const written = ["quire".replace(/^/, "re"), "requir".replace(/$/, "e"), ("b" + "c").replace(/^/, `a`), "".replace(/$/, ""), "a\nb".replace(/$/, "!"), "é𝒳".replace(/^/, "ü"), "é𝒳".replace(/$/, "ü")];
console.log(written.join(" | "));
const text = ["qui", "re"].join("");
const beside = ["a".replace(/^/g, "b"), "a\nb".replace(/$/m, "!"), "a".replace(/^/, "$&$&"), "a".replace(/^/, "$$"), "a".replace(/a/, "b"), "a".replace("a", "b"), "a".replace(/^/, () => "c"), text.replace(/^/, "re"), "a".replace(/^/), "a".replaceAll(/^/g, "b")];
console.log(beside.join(" | "));
console.log(typeof "quire".replace(/^/, "re"), "quire".replace(/^/, "re").length, "quire".replace(/^/, "re") === "require");
