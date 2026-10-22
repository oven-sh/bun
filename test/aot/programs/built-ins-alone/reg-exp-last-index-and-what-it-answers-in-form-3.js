const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
pattern.lastIndex = "an";
console.log(typeof pattern.lastIndex, pattern.lastIndex.length, pattern.lastIndex);
