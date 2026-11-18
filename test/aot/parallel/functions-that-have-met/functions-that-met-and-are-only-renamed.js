function rename(...functions) { for (const each of functions) Object.defineProperty(each, "name", { value: "renamed" }); }
function alpha() { return "a"; }
function beta() { return "b"; }
function gamma() { return "c"; }
rename(alpha, beta, gamma);
console.log(alpha(), beta.name, typeof gamma);
