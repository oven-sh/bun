function each(...functions) { let text = ""; for (const one of functions) text += one(); return text; }
function alpha() { return "a"; }
function beta() { return "b"; }
console.log(each(alpha, beta));
