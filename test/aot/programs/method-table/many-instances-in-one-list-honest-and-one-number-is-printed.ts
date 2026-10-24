// The honest twin of the programs that cover a method on one instance: the same family, the same lists and the same calls, and no instance ever gets a member of its own. One number is printed.
class Note {
  constructor(public pitch: number) {}
  sound(): number {
    return this.pitch;
  }
}
class Sharp extends Note {
  sound(): number {
    return this.pitch + 1;
  }
}
class Rest extends Note {}

function play(notes: Note[]): number {
  let sum = 0;
  for (const one of notes) sum = (sum * 3 + one.sound()) % 1000003;
  return sum;
}

function soundOf(one: Note): number {
  return one.sound();
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const notes: Note[] = [];
for (let i = 0; i < 30; i++) notes.push(new Note(i), new Sharp(i), new Rest(i));

note(play(notes));
note(soundOf(notes[4]));
note(soundOf(notes[8]));
notes[4].pitch = 100;
note(play(notes));
let sum = 0;
for (let round = 0; round < 1000; round++) sum = (sum + play(notes)) % 1000003;
note(sum);
console.log(checksum);

export {};
