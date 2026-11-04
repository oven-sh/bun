// text.split(",").map(f).filter(g): the second callback throws at its first call, behind the last call of the first
const hidden = JSON.parse('{"text":"1,2,,x,5"}');
const log: string[] = [];
let isArmed = false;
function note(text: string) { log.push(text); }
function show(value: any): string {
  if (!Array.isArray(value)) return typeof value + " " + String(value);
  let text = "[";
  for (let index = 0; index < value.length; index++) text += (index ? "," : "") + (index in value ? String(value[index]) : "hole");
  return text + "]";
}
function subject(text: string) {
  return text.split(",").map(piece => { note("f" + piece); return Number(piece); }).filter(number => { note("g" + number); if (isArmed) throw new RangeError("second"); return number === number; });
}
function run(text: string) {
  log.length = 0;
  let answer: string;
  try { answer = show(subject(text)); } catch (error: any) { answer = error.name + ": " + error.message; }
  console.log(answer + " | " + log.join(" "));
}
run("1,2,3");
for (let turn = 0; turn < 3; turn++) run(turn + ",a," + turn);
run(hidden.text);
isArmed = true;
run(hidden.text);
isArmed = false;
run("");
run("1,2,3");
