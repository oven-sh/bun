// The constructor of one class of the family stores `this.sound.bind(this)` on each of its instances, so each has a member of its own over the method. Replacing the method on the prototype later changes new instances and leaves the old ones.
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

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

const notes: Note[] = [new Note(1), new Bound(2), new Deep(3)];
note("at first", play(notes));
const taken = notes[1].sound;
note("taken off its object", taken());
Bound.prototype.sound = () => 7;
Deep.prototype.sound = () => 8;
note("after both methods are replaced", play(notes));
note("new instances", play([new Note(1), new Bound(2), new Deep(3)]));
Reflect.deleteProperty(notes[1], "sound");
Reflect.deleteProperty(notes[2], "sound");
note("the old ones without their own members", play(notes));

export {};
