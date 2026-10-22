const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
pattern.lastIndex = 1.5;
console.log(typeof pattern.lastIndex, pattern.lastIndex + 1);
