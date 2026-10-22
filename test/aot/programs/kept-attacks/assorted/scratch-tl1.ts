// Assorted, one probe of many. It prints what plain Bun prints.
class Light {
  lift = 1;
  toString(): string {
    return "light " + this.lift;
  }
}
console.log(new Light().toLocaleString());
