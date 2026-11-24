function run(count: number): string {
  let shown = "";
  let text = "<";
  for (let i = 0; i < count; i++) {
    text += i % 10;
    if (i % 5 === 4) {
      shown = shown.length < 400 ? shown + text + ";" : shown;
      const which = (i / 5 | 0) % 4;
      text = which === 0 ? "[[" : which === 1 ? "" : which === 2 ? "é" : "世界";
    }
  }
  return shown + text;
}
console.log(run(60));
console.log(run(4000).length);
