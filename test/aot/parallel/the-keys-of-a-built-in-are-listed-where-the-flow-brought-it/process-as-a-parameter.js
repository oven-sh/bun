function walked(object) {
  let seen = false;
  for (const key in object) {
    if (key === "_eventsCount") seen = true;
  }
  return seen;
}
const inLoop = [];
for (let turn = 0; turn < 4; turn++) inLoop.push(walked(process));
console.log(inLoop.join(), "_eventsCount" in process, Object.keys(process).includes("_eventsCount"));
