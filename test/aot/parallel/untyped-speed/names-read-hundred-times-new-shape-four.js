// Two names are read thirty-two times off an object out of JSON.parse. Once every object has the same names, once each has a name of its own beside them.
// What a read finds off a new shape is filed at the sixteenth miss at the latest, and the reads behind that find it at once: each of the two names is filed once for each of the hundred and one shapes.
// COUNT: operation:operationAOTGetByIdAndCache >= 200
// COUNT: operation:operationAOTGetByIdAndCache <= 300
function sum(record) {
  return record.first + record.second;
}
function read(record) {
  let s = 0;
  for (let k = 0; k < 32; k++) s = (s + sum(record)) | 0;
  return s;
}
let made = 0;
function ofOneShape(rounds) {
  let s = 0;
  for (let r = 0; r < rounds; r++) s = (s + read(JSON.parse(`{"field":1,"first":${r},"second":2}`))) | 0;
  return s;
}
function ofNewShapes(rounds) {
  let s = 0;
  for (let r = 0; r < rounds; r++) s = (s + read(JSON.parse(`{"field${made++}":1,"first":${r},"second":2}`))) | 0;
  return s;
}
console.log(ofOneShape(100), ofNewShapes(100));
