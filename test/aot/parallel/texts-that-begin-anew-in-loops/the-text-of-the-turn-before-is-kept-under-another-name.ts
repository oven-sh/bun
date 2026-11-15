function run(count: number): string {
  let text = "";
  let kept = "none";
  let out = "";
  for (let i = 0; i < count; i++) {
    text += i;
    if (i % 4 === 3) {
      kept = text;
      text = "";
    }
    if (i % 6 === 5) out += kept + "/" + text + ",";
  }
  return out;
}
console.log(run(40));
