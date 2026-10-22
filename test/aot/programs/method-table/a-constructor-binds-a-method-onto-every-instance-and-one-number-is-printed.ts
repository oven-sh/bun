// The constructor of one class of the family stores `this.sound.bind(this)` on each of its instances, so each has a member of its own over the method. Replacing the method on the prototype later changes new instances and leaves the old ones. One number is printed.
class Note {
  constructor(public pitch: number) {}
  sound(): number {
    return this.pitch;
  }
}
class Bound extends Note {
  constructor(pitch: number) {
    super(pitch);
    this.sound = this.sound.bind(this);
  }
  sound(): number {
    return this.pitch + 1;
  }
}
class Deep extends Bound {
  sound(): number {
    return this.pitch + 2;
  }
}

function play(notes: Note[]): number {
  let sum = 0;
  for (const one of notes) sum = sum * 10 + one.sound();
  return sum;
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const notes: Note[] = [new Note(1), new Bound(2), new Deep(3)];
note(play(notes));
const taken = notes[1].sound;
note(taken());
Bound.prototype.sound = () => 7;
Deep.prototype.sound = () => 8;
note(play(notes));
note(play([new Note(1), new Bound(2), new Deep(3)]));
Reflect.deleteProperty(notes[1], "sound");
Reflect.deleteProperty(notes[2], "sound");
note(play(notes));
console.log(checksum);

export {};
