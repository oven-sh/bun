// A File that is appended under no other name is handed out as the object that it is: by get, getAll, the iterators, forEach and toJSON.
const file = new File(["bytes"], "made.txt");
file.mark = 1;
const form = new FormData();
form.append("a", file);
const back = form.get("a");
back.mark = 2;
console.log(`${back === file} ${file.mark} ${form.getAll("a")[0] === file}`);
for (const [, value] of form) value.mark++;
for (const value of form.values()) value.mark++;
form.forEach(value => void value.mark++);
form.toJSON().a.mark++;
console.log(file.mark);
