// Object.assign copies a literal that has a method of the same name onto one instance, and copies one instance that has a member of its own onto another. Typed calls on those two find the copies; all others find their class's method. One number is printed.
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

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const notes: Note[] = [new Note(1), new Sharp(2), new Rest(3), new Note(4), new Sharp(5), new Rest(6)];

note(play(notes));
Object.assign(notes[1], {
  sound() {
    return 100;
  },
});
note(play(notes));
Object.assign(notes[5], notes[1]);
note(play(notes));
note(notes[5].pitch);
Object.assign(notes[3], notes[0]);
note(play(notes));
Object.assign(notes[2], { sound: Sharp.prototype.sound, pitch: 50 });
note(play(notes));
console.log(checksum);

export {};
