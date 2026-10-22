const pattern = /a/g;
console.log(pattern.lastIndex);
pattern.exec("banana");
console.log(pattern.lastIndex);
pattern.test("banana");
console.log(pattern.lastIndex);
"banana".replace(pattern, "-");
console.log(pattern.lastIndex);
