// characters of a rope are read in a loop that stands under a handler, and the handler reads what the turns have counted
function grown(n: number) {
  let text = "";
  for (let i = 0; i < n; i++) text += "abĀ";
  return text;
}
function scan(text: string, stopAt: number) {
  let sum = 0;
  let turns = 0;
  try {
    for (let i = 0; i < text.length; i++) {
      turns = i;
      sum = (sum * 31 + text.charCodeAt(i)) | 0;
      if (i === stopAt) throw new Error("stopped");
    }
  } catch (error) {
    return (error as Error).message + ":" + turns + ":" + sum;
  }
  return "through:" + turns + ":" + sum;
}
function deed() {
  return [scan(grown(4), 5), scan(grown(4), -1), scan("", 0), scan("a", 0)].join(" ");
}
console.log(deed());
for (let i = 0; i < 20; i++) deed();
console.log(deed());
