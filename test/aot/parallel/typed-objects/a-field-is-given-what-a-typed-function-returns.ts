// A function that says it returns a string returns one here, so a field that is given its result holds a string: nothing that reads the field asks whether it is undefined or null.
// COUNT: branches <= 90000
interface Note {
  role: string;
  text: string;
  mark: string | undefined;
  done: boolean;
}
const word: string = process.env.WORD_OF_THE_NOTE ?? "lit";
function lines(): string {
  return "line of " + word;
}
function mark(turn: number): string | undefined {
  return turn & 1 ? "odd" : undefined;
}
function done(): boolean {
  return true;
}
function write(turns: number): number {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    const note: Note = { role: word, text: lines(), mark: mark(turn), done: done() };
    sum += JSON.stringify(note).length;
  }
  return sum;
}
console.log(write(20000));
const last: Note = { role: word, text: lines(), mark: mark(1), done: done() };
console.log(JSON.stringify(last), last.text.length, last.mark?.length, last.done);
