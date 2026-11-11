function route(path: string): string {
  const parts = path.split("/");
  if (parts.length === 5 && parts[1] === "users" && parts[3] === "posts") return "posts of " + parts[2] + ": " + parts[4];
  if (parts[1] === "text") return "text";
  if (parts[5] === "deep") return "deep";
  if (parts[1] !== "json") return "other " + parts.length;
  return "json";
}
const seen: string[] = [];
for (const path of ["/users/7/posts/9", "/users/7/post/9", "/user/7/posts/9", "/text", "/texts", "/tex", "/json", "", "/", "//", "/a/b/c/d/deep", "/a/b/c/d/deeper", "users", "/users/7/posts/9/"]) seen.push(route(path));
console.log(seen.join(" | "));
