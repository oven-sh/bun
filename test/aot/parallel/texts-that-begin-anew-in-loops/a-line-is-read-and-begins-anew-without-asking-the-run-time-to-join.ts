// COUNTER: operationAOTConcat <= 2
// COUNTER: operationAOTConcatenate <= 2
function run(count: number): number {
  let line = "";
  let sum = 0;
  for (let i = 0; i < count; i++) {
    line += "x";
    if ((i & 1023) === 1023) {
      sum += line.length + line.charCodeAt(line.length >> 1);
      line = "";
    }
  }
  return sum + line.length;
}
console.log(run(300000));
