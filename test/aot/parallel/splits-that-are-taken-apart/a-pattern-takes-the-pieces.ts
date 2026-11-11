// What is printed is what plain Bun prints.
function pair(text: string) {
  const [name, value] = text.split("=");
  return name + "<" + value + ">";
}
function three(text: string) {
  const [, second, third = "none"] = text.split(":");
  return second + "+" + third;
}
console.log("SAID " + ["a=b", "a", "=", "a=b=c", ""].map(pair).join(" ") + " " + ["a:b:c", "a:b", "a", "::"].map(three).join(" "));
