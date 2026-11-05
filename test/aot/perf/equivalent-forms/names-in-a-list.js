// A name cut out of a text is looked for in a list of such names, by a loop and by indexOf(). ../equivalent-forms.test.ts holds the pair together.
const which = process.argv[2] ?? "";
const rounds = Number(process.argv[3] ?? "64");

let text = "";
for (let i = 0; i < 64; i++) text += "name" + ((i * 37) & 63) + "x".repeat(i & 3) + " ";
const declared = [];
for (let start = 0; start < text.length; ) {
  const end = text.indexOf(" ", start);
  declared.push(text.slice(start, end));
  start = end + 1;
}
const asked = declared.map(name => (" " + name).slice(1));

function findByLoop(list, name) {
  for (let i = 0; i < list.length; i++) if (list[i] === name) return i;
  return -1;
}

const loops = {
  "a name found by a loop": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += findByLoop(declared, asked[i & 63]);
    return sum;
  },
  "a name found by indexOf": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += declared.indexOf(asked[i & 63]);
    return sum;
  },
};

if (which) console.log(which, loops[which](rounds));
else for (const name in loops) console.log(name, loops[name](rounds), loops[name](3));
