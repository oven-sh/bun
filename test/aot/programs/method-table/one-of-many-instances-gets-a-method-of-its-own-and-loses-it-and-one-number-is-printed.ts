// Nine objects of three classes lie in one list. A store gives one of them a member of its own under the name of the method; only that object changes. Then the member is deleted and the object finds its class's method again. One number is printed.
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
  for (const one of notes) sum = sum * 3 + one.sound();
  return sum;
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const notes: Note[] = [];
for (let i = 0; i < 3; i++) notes.push(new Note(i), new Sharp(i), new Rest(i));

note(play(notes));
notes[4].sound = () => 100;
note(play(notes));
notes[8].sound = function () {
  return this.pitch + 200;
};
note(play(notes));
Sharp.prototype.sound = () => 7;
note(play(notes));
Reflect.deleteProperty(notes[4], "sound");
note(play(notes));
Reflect.deleteProperty(notes[8], "sound");
note(play(notes));
notes[4].sound = Note.prototype.sound;
note(play(notes));
console.log(checksum);

export {};
