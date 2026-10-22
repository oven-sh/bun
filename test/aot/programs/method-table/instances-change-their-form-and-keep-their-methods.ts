// Instances get forms that no constructor makes: frozen, sealed, with members that the class does not declare, with elements, with a field deleted, with a field turned into an accessor, with two hundred more members. None of that touches the method, and every call finds it.
class Note {
  loud?: number = 1;
  constructor(public pitch: number) {}
  sound(): number {
    return this.pitch + (this.loud ?? 1000);
  }
}
class Sharp extends Note {
  sound(): number {
    return this.pitch * 2 + (this.loud ?? 2000);
  }
}
class Rest extends Note {}

function play(notes: Note[]): number {
  let sum = 0;
  for (const one of notes) sum += one.sound();
  return sum;
}

function change(make: () => Note): Note[] {
  const frozen = Object.freeze(make());
  const sealed = Object.seal(make());
  const closed = Object.preventExtensions(make());
  const wider = Object.assign(make(), { extra: 1, more: "two" });
  const listed = Object.assign(make(), [7, 8, 9]);
  const marked = Object.assign(make(), { [Symbol.iterator]: 5 });
  const shorter = make();
  delete shorter.loud;
  const computed = make();
  Object.defineProperty(computed, "pitch", { get: () => 500, configurable: true });
  const crowded = make();
  for (let i = 0; i < 200; i++) Object.assign(crowded, { ["member" + i]: i });
  return [frozen, sealed, closed, wider, listed, marked, shorter, computed, crowded];
}

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

note("notes", play(change(() => new Note(3))));
note("sharps", play(change(() => new Sharp(4))));
note("rests", play(change(() => new Rest(5))));
const all = [...change(() => new Note(3)), ...change(() => new Sharp(4)), ...change(() => new Rest(5))];
let sum = 0;
for (let round = 0; round < 100; round++) sum += play(all);
note("all of them, a hundred times", sum);
Sharp.prototype.sound = () => 1;
note("after the override is replaced", play(all));

export {};
