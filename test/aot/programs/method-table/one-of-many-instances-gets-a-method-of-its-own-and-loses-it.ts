// Nine objects of three classes lie in one list. A store gives one of them a member of its own under the name of the method; only that object changes. Then the member is deleted and the object finds its class's method again.
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

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

const notes: Note[] = [];
for (let i = 0; i < 3; i++) notes.push(new Note(i), new Sharp(i), new Rest(i));

note("at first", play(notes));
notes[4].sound = () => 100;
note("the fifth has its own", play(notes));
notes[8].sound = function () {
  return this.pitch + 200;
};
note("the ninth too", play(notes));
Sharp.prototype.sound = () => 7;
note("the class of the fifth is changed as well", play(notes));
Reflect.deleteProperty(notes[4], "sound");
note("the fifth loses its own", play(notes));
Reflect.deleteProperty(notes[8], "sound");
note("the ninth too", play(notes));
notes[4].sound = Note.prototype.sound;
note("the fifth holds the method of the base class", play(notes));

export {};
