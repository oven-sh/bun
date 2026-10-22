// Object.defineProperty covers a method on single instances: with a hidden value, with a getter that answers a function, and with a value that is no function, which makes the call a TypeError. The other instances keep their class's method.
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

function soundOf(one: Note): number {
  return one.sound();
}

function attempt(one: Note): number {
  try {
    return soundOf(one);
  } catch (error) {
    return error instanceof TypeError ? -1 : -2;
  }
}

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

const notes: Note[] = [new Note(10), new Sharp(20), new Rest(30), new Note(40), new Sharp(50), new Rest(60)];
let reads = 0;

for (const one of notes) note("at first", attempt(one));
Object.defineProperty(notes[0], "sound", { value: () => 1, enumerable: false, configurable: true });
Object.defineProperty(notes[1], "sound", {
  get(this: Note) {
    reads++;
    return () => this.pitch + 2;
  },
  configurable: true,
});
Object.defineProperty(notes[2], "sound", { value: 3, configurable: true });
for (const one of notes) note("three are covered", attempt(one));
note("times the getter ran", reads);
note("own names of the first", Object.keys(notes[0]).length);
for (let i = 0; i < 3; i++) Reflect.deleteProperty(notes[i], "sound");
for (const one of notes) note("uncovered", attempt(one));

export {};
