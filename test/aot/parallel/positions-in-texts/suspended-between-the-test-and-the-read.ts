// a generator yields between the test and the read, and whoever steps it moves nothing of its own
function* codes(text: string): Generator<number, void, void> {
  for (let pos = 0; pos < text.length; pos++) {
    yield -1;
    yield text.charCodeAt(pos);
  }
}
function deed(): string {
  return [...codes("abc")].join() + "|" + [...codes("")].join();
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
