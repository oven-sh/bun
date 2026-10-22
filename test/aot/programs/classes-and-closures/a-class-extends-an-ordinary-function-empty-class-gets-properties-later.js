// A class extends an ordinary function: the class has no field and its instance gets properties later.
function base() {}
class Bag extends base {}
const made = new Bag();
made.first = 1;
made.second = "two";
let keys = "";
for (const key in made) keys += key;
console.log(made.first, made.second, keys, Object.keys(made).length, made instanceof Bag, made instanceof base);
