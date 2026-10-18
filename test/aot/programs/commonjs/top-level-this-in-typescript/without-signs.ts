let local: number = 30;
console.log("without-signs.ts", eval("local + 1"));
eval("local = 35");
console.log(local);
