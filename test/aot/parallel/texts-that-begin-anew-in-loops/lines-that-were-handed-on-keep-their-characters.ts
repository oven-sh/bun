function run(count: number): string {
  const lines: string[] = [];
  let line = "";
  for (let i = 0; i < count; i++) {
    line += String.fromCharCode(97 + (i % 26));
    if (i % 7 === 6) {
      lines.push(line);
      line = "";
    }
  }
  lines.push("rest:" + line);
  return lines.join("|");
}
const all = run(100);
console.log(all);
console.log(run(5000).length);
