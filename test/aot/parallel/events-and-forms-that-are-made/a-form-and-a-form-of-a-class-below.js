const form = new FormData();
form.append("a", "b");
form.append("a", "c");
form.set("d", "e");
form.delete("d");
const seen = [];
form.forEach((value, name) => seen.push(`${name}=${value}`));
console.log(`${form.get("a")} ${form.getAll("a").join()} ${form.has("d")} ${seen.join("&")} ${[...form.keys()].join()}`);
class Named extends FormData {
  constructor(name) {
    super({ get never() { throw new Error("never read"); } });
    this.name = name;
  }
  first(key) {
    return this.get(key);
  }
}
const named = new Named("g");
named.append("h", "i");
console.log(`${named.name} ${named.first("h")} ${named instanceof FormData}`);
