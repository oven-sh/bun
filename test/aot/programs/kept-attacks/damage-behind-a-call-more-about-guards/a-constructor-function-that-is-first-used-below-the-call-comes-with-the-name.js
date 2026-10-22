// One site sees objects of two constructor functions. The class of a constructor function is made by its first construction, and a test that speaks of several classes does not wait for a class that does not exist yet.
// The prototype object of the second function has had the name from the start. Its first object is made below a call of the caller that has passed the test, and comes back as the result of that call.
function Early(id) {
  this.id = id;
  if (id % 5 === 0) this.owner = "own" + id;
}
function Late(id) {
  this.id = id;
  if (id % 5 === 0) this.note = "own" + id;
}
Late.prototype.owner = "owner of every Late";

var wantsLate = false;
function make(id) {
  if (wantsLate) return new Late(id);
  return new Early(id);
}

function describe(p) {
  return p.id + ":" + p.owner + ":" + p.note;
}

function holder(p, round) {
  var before = p.owner + "," + p.note;
  var q = make(round + 1);
  return before + " " + q.owner + "," + q.note + " " + p.owner + "," + p.note + " " + describe(q);
}

var digest = 0;
for (var round = 0; round < 400; round++) {
  wantsLate = round >= 200 && round % 2 === 0;
  var line = holder(new Early(round), round);
  for (var index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 198 && round <= 205) || round === 399) console.log(round + ": " + line);
  if (round === 300) Early.prototype.note = "note of every Early";
}
console.log("digest " + digest);
