// One literal in a loop lies under another prototype each time round, null among them.
const cat = { sound() { return "meow"; } };
const dog = { sound() { return "woof"; }, fetch() { return "stick"; } };
const chain: any[] = [cat, null, dog, Object.prototype, null];
let said = "";
for (let index = 0; index < chain.length; index++) {
  const pet: any = { __proto__: chain[index], index };
  said += typeof pet.sound === "function" ? pet.sound() : "silent";
  said += typeof pet.fetch === "function" ? pet.fetch() : "";
  said += typeof pet.toString + " ";
}
console.log(said);
