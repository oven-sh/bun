// A class expression in the body of a loop is evaluated six times and each class closes over its own round. One call site sees the objects of all six. The method of the third class is replaced and that of the fifth is deleted, which leaves nothing: the base only declares it.
abstract class Speaker {
  abstract speak(): number;
  loud(): number {
    return this.speak() * 2;
  }
}

const classes: { new (): Speaker; prototype: Speaker }[] = [];
for (let round = 0; round < 6; round++) {
  classes.push(
    class extends Speaker {
      speak(): number {
        return round + 1;
      }
    },
  );
}

function loudOf(speaker: Speaker): number {
  return speaker.loud();
}

function attempt(speaker: Speaker): number {
  try {
    return loudOf(speaker);
  } catch (error) {
    return error instanceof TypeError ? -1 : -2;
  }
}

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

const speakers: Speaker[] = [];
for (const each of classes) speakers.push(new each());

for (const speaker of speakers) note("at first", attempt(speaker));
classes[2].prototype.speak = () => 50;
Reflect.deleteProperty(classes[4].prototype, "speak");
for (const speaker of speakers) note("after the changes", attempt(speaker));
for (const each of classes) note("new objects", attempt(new each()));

export {};
