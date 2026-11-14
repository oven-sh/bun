// What is printed is what plain Bun prints.
function look(text: string) {
  const parts = text.split("/");
  return [parts.length, parts[0], parts[1], parts[2], parts[4]].map(String).join("|");
}
const long = "a/" + "b".repeat(300) + "/c";
const texts = ["", "/", "//", "a", "a/", "/a", "a/b", "/users/7/posts/9", "a/b/c/d/e/f/g", "é/ü", "中/文/x", long, ("x/" + Math.random().toString().slice(0, 0)) + "y/z"];
console.log("SAID " + texts.map(look).join(" ; "));
