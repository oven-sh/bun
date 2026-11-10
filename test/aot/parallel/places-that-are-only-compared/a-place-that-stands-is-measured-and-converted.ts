function read(line: string): string {
  const parts = line.split(":");
  const count = parts[1];
  if (count === undefined) return "none";
  const more = parts[2];
  return count.length + " " + Number(count) + " " + parseInt(count, 10) + " " + (count === "12") + " " + (more !== undefined ? more.length : -1);
}
console.log(["a", "a:", "a:12", "a:12:x", "a: 7 ", "a:0x1f", "a:twelve:", "a:12.5:yz"].map(read).join(" | "));
