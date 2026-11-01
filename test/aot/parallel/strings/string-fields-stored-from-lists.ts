// Fields that hold one of a few written strings, stored from lists and read in every way.
const texts = ["plain", "шире", "again", "ещё", ""];
const out: unknown[] = [];

const holder = { text: "plain" };
for (let i = 0; i < 7; i++) {
  holder.text = texts[i % 5]!;
  out.push(holder.text.length, holder.text.charCodeAt(0), holder.text + "!", holder.text ? 1 : 0, typeof holder.text);
}
out.push(JSON.stringify(holder), Object.values(holder), { ...holder }, Object.entries(holder));

class Base {
  name = "base";
  describe() {
    return this.name.toUpperCase() + this.name.length;
  }
}
class Derived extends Base {
  extra = "extra";
}
const instances = [new Base(), new Derived(), new Derived()];
for (let i = 0; i < 6; i++) {
  const instance = instances[i % 3]!;
  instance.name = texts[i % 5]!;
  out.push(instance.describe(), instance.name.slice(1), instance instanceof Derived ? instance.extra.length : -1);
}
out.push(JSON.stringify(instances));

const first = { label: "one", a: 1 };
const second = { b: 2, label: "two" };
for (let i = 0; i < 6; i++) {
  const either = i & 1 ? first : second;
  either.label = texts[i % 5]!;
  out.push(either.label.length, `${either.label}`);
}
out.push(first, second);

const compared = { tag: "plain" };
for (let i = 0; i < 6; i++) {
  compared.tag = texts[i % 5]!;
  out.push(compared.tag === "again", compared.tag.length);
  switch (compared.tag) {
    case "plain":
      out.push("p");
      break;
    case "":
      out.push("empty");
      break;
    default:
      out.push("other");
  }
}

const key = ["te", "xt"].join("");
(holder as Record<string, unknown>)[key] = ["made", "at", "run", "time"].join(" ");
out.push(holder.text.length, holder.text, (holder as Record<string, unknown>)[key]);
Object.assign(holder, { text: texts[1] });
out.push(holder.text.length, holder.text.codePointAt(0));
console.log(JSON.stringify(out));
