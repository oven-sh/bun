const read = [];
const watched = new Proxy({}, { get(target, name) { read.push(String(name)); return undefined; }, ownKeys() { read.push("keys"); return []; } });
const form = new FormData(watched, { toString() { read.push("text"); return "x"; } });
console.log(`${read.length} ${form.length} ${[...form].length} ${form instanceof FormData} ${Object.keys(form).length}`);
form.append("a", "b");
form.append("a", "c");
form.set("d", new Blob(["e"]), "f.txt");
console.log(`${form.get("a")} ${form.getAll("a").join()} ${form.has("d")} ${form.get("d").name} ${form.length}`);
class Named extends FormData {
  constructor(name) {
    super();
    this.name = name;
  }
  first(key) {
    return this.get(key);
  }
}
const named = new Named("g");
named.append("h", "i");
console.log(`${named.name} ${named.first("h")} ${named instanceof FormData} ${new FormData() !== new FormData()}`);
try {
  FormData();
} catch (error) {
  console.log(`${error.name}`);
}
