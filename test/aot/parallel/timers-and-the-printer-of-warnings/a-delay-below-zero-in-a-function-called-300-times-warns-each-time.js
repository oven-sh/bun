let heard = 0;
process.on("warning", () => { heard++; });
let work = 0;
function arm(delay) {
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return setTimeout(() => {}, delay);
}
for (let i = 0; i < 300; i++) arm(i % 100 === 0 ? -1 : 1);
setTimeout(() => console.log("heard", heard, work), 20);
