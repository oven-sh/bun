// The elements of a list, the characters of a text and the bytes of a view are read in front of a try and again behind its handler.
// Nobody but the function holds the list, the text or the view by then.
class Holder {
  list: number[] | null = null;
  objects: { value: number }[] | null = null;
  text: string | null = null;
  view: Uint8Array | null = null;
  floats: Float64Array | null = null;
}

let caught: unknown = null;
function note(error: unknown): number {
  caught = error;
  return 1;
}

function fill(holder: Holder, round: number): void {
  const list: number[] = [];
  const objects: { value: number }[] = [];
  for (let i = 0; i < 40; i++) {
    list.push(round + i + 0.5);
    objects.push({ value: round + i });
  }
  holder.list = list;
  holder.objects = objects;
  let text = "";
  for (let i = 0; i < 40; i++) text += String.fromCharCode(97 + ((round + i) % 26));
  holder.text = text;
  const view = new Uint8Array(40);
  const floats = new Float64Array(40);
  for (let i = 0; i < 40; i++) {
    view[i] = (round + i) & 255;
    floats[i] = round + i + 0.25;
  }
  holder.view = view;
  holder.floats = floats;
}

function numbers(holder: Holder, maybe: { x: number } | null): number {
  const list = holder.list!;
  holder.list = null;
  let sum = list[0] + list[1];
  try {
    sum += maybe!.x;
  } catch (error) {
    sum += note(error);
  }
  return sum + list[2] + list[3] + list[39];
}

function objects(holder: Holder, maybe: { x: number } | null): number {
  const list = holder.objects!;
  holder.objects = null;
  let sum = list[0].value + list[1].value;
  try {
    sum += maybe!.x;
  } catch (error) {
    sum += note(error);
  }
  return sum + list[2].value + list[3].value + list[39].value;
}

function characters(holder: Holder, maybe: { x: number } | null): number {
  const text = holder.text!;
  holder.text = null;
  let sum = text.charCodeAt(0) + text.charCodeAt(1);
  try {
    sum += maybe!.x;
  } catch (error) {
    sum += note(error);
  }
  return sum + text.charCodeAt(2) + text.charCodeAt(3) + text.charCodeAt(39);
}

function bytes(holder: Holder, maybe: { x: number } | null): number {
  const view = holder.view!;
  holder.view = null;
  let sum = view[0] + view[1];
  try {
    sum += maybe!.x;
  } catch (error) {
    sum += note(error);
  }
  return sum + view[2] + view[3] + view[39];
}

function floats(holder: Holder, maybe: { x: number } | null): number {
  const view = holder.floats!;
  holder.floats = null;
  let sum = view[0] + view[1];
  try {
    sum += maybe!.x;
  } catch (error) {
    sum += note(error);
  }
  return sum + view[2] + view[3] + view[39];
}

function inALoop(holder: Holder, maybe: { x: number } | null): number {
  const list = holder.list!;
  const text = holder.text!;
  holder.list = null;
  holder.text = null;
  let sum = 0;
  for (let i = 0; i < list.length; i++) {
    try {
      sum += list[i] + text.charCodeAt(i);
      if ((i & 7) === 3) sum += maybe!.x;
    } catch (error) {
      sum += note(error);
    }
  }
  return sum;
}

function litter(round: number): number {
  let text = "";
  const lists: number[][] = [];
  for (let i = 0; i < 20; i++) {
    text += String.fromCharCode(65 + ((round + i) % 26));
    lists.push([round + 0.75, i + 0.75, 3.75, 4.75, 5.75, 6.75]);
  }
  return text.length + lists.length;
}

const nothing: { x: number } | null = process.env.SOMETHING ? { x: 1 } : null;
const holder = new Holder();
const rounds = 1500;
let total = 0;
for (let round = 0; round < rounds; round++) {
  fill(holder, round);
  total +=
    numbers(holder, nothing) +
    objects(holder, nothing) +
    characters(holder, nothing) +
    bytes(holder, nothing) +
    floats(holder, nothing);
  total += litter(round);
  fill(holder, round);
  total += inALoop(holder, nothing);
}
console.log(total, caught instanceof Error ? caught.name : String(caught));
