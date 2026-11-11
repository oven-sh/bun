function ends(path: string): string {
  const parts = path.split("/");
  return [parts[0] === "", parts[1] === "", parts[2] === "", parts[1] !== "", parts[2] !== ""].join(",");
}
console.log(["", "/", "//", "a", "a/", "/a", "a//b"].map(ends).join(" | "));
