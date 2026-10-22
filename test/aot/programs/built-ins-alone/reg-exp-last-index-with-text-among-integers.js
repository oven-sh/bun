const pattern = new RegExp("(a)(?<rest>n)?(?<none>x)?", "g");
pattern.lastIndex = "text";
console.log(typeof pattern.lastIndex, pattern.lastIndex.length, pattern.lastIndex);
