// Object.assign copies a literal that has a method of the same name onto one instance, and copies one instance that has a member of its own onto another. Typed calls on those two find the copies; all others find their class's method.
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
  for (const one of notes) sum = sum * 7 + one.sound();
  return sum;
}

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

const notes: Note[] = [new Note(1), new Sharp(2), new Rest(3), new Note(4), new Sharp(5), new Rest(6)];

note("at first", play(notes));
Object.assign(notes[1], {
  sound() {
    return 100;
  },
});
note("a literal with a method onto the second", play(notes));
Object.assign(notes[5], notes[1]);
note("the second onto the sixth", play(notes));
note("the pitch of the sixth", notes[5].pitch);
Object.assign(notes[3], notes[0]);
note("an instance without a member of its own onto the fourth", play(notes));
Object.assign(notes[2], { sound: Sharp.prototype.sound, pitch: 50 });
note("the method of another class and a field onto the third", play(notes));

export {};
