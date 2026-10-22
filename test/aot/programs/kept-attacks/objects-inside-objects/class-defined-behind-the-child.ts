// The object that a field initializer of a class names is made before the class is defined. Whoever lays the two objects into one cell would need the class at the birth of the first.
interface Like { size: number }
class Part implements Like { size = 1; grow() { this.size++; return this; } }
const part = new Part();
const lines: string[] = [];
{
  class Holder { #held: Like = part; label = "h"; get held() { return this.#held; } }
  const holder = new Holder();
  lines.push(holder.held === part ? "same" : "other", String(holder.held.size), holder.label, Holder.name, String(Object.getPrototypeOf(holder) === Holder.prototype));
}
const literal = { size: 7 };
{
  class Wrapper { inner: Like; constructor(inner: Like) { this.inner = inner; } }
  const wrapper = new Wrapper(literal);
  lines.push(String(wrapper.inner === literal), String(wrapper instanceof Wrapper), String(wrapper.inner.size));
}
function later(): string {
  const made = new Part().grow();
  class Local { kept = made; }
  const local = new Local();
  return String(local.kept === made) + local.kept.size + Local.name + (local instanceof Local);
}
lines.push(later(), later());
console.log(lines.join(" "));
