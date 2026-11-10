// The names of the doors come from outside, so nothing is copied in line and the list is out of sight where it is spliced.
// COUNT: operation:operationAOTArraySpliceOfAnyList <= 32
const [OUT, INTO] = JSON.parse('["out","into"]');
const reads = { out(list, at) { return list.splice(at, 1); } };
const ask = (door, ...rest) => reads[door](...rest);
for (let turn = 0; turn < 4; turn++)
  for (const at of [0, 1, 2, 3]) {
    const list = [1, , 3, , 5]; list.push(0); list.pop();
    const answer = ask(OUT, list, at);
    console.log("SAID", at, answer.length, 0 in answer, String(answer[0]), list.length, Array.from({ length: list.length }, (_, i) => (i in list ? String(list[i]) : "hole")).join());
    const wholes = Array.from([1, 2, 3, 4, 5]);
    delete wholes[1];
    delete wholes[3];
    const gone = ask(OUT, wholes, at);
    console.log("SAID wholes", at, gone.length, 0 in gone, String(gone[0]), wholes.length, Array.from({ length: wholes.length }, (_, i) => (i in wholes ? String(wholes[i]) : "hole")).join());
    const fractions = Array.from([0.5, 1.5, 2.5, 3.5, 4.5]);
    delete fractions[1];
    delete fractions[3];
    const went = ask(OUT, fractions, at);
    fractions.length = 5;
    console.log("SAID fractions", at, went.length, 0 in went, String(went[0]), Array.from({ length: fractions.length }, (_, i) => (i in fractions ? String(fractions[i]) : "hole")).join());
  }
