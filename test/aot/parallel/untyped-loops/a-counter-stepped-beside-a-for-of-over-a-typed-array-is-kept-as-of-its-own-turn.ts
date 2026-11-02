// A counter is stepped beside `for (const value of view)` over a typed array, and a branch keeps the counter of its own turn.
// Where the turns of such a loop are written out in blocks, what the branch keeps is still the counter of that turn, and nothing where the branch is not taken.
// Every kind of view has functions of its own: a function that gets several kinds takes another loop.
function filledInt16Array(length: number, step: number): Int16Array {
  const view = new Int16Array(length);
  for (let index = 0; index < length; index++) view[index] = (index * step + 3) % 11;
  return view;
}
function placeOfGreatestInInt16Array(view: Int16Array, start: number): string {
  let greatest = start;
  let place = start;
  let turn = -1;
  for (const value of view) {
    turn++;
    if (value > greatest) {
      greatest = value;
      place = turn;
    }
  }
  return greatest + "," + place;
}
function lastPlaceAboveInInt16Array(view: Int16Array, limit: number): number {
  let place = -5;
  let turn = 1;
  for (const value of view) {
    turn++;
    if (value > limit) place = turn;
  }
  return place;
}
function placeCountedByTwoInInt16Array(view: Int16Array, start: number): string {
  let greatest = start;
  let place = start;
  let turn = 0;
  for (const value of view) {
    turn += 2;
    if (value > greatest) {
      greatest = value;
      place = turn;
    }
  }
  return greatest + "," + place;
}
function filledFloat64Array(length: number, step: number): Float64Array {
  const view = new Float64Array(length);
  for (let index = 0; index < length; index++) view[index] = (index * step + 3) % 11;
  return view;
}
function placeOfGreatestInFloat64Array(view: Float64Array, start: number): string {
  let greatest = start;
  let place = start;
  let turn = -1;
  for (const value of view) {
    turn++;
    if (value > greatest) {
      greatest = value;
      place = turn;
    }
  }
  return greatest + "," + place;
}
function lastPlaceAboveInFloat64Array(view: Float64Array, limit: number): number {
  let place = -5;
  let turn = 1;
  for (const value of view) {
    turn++;
    if (value > limit) place = turn;
  }
  return place;
}
function placeCountedByTwoInFloat64Array(view: Float64Array, start: number): string {
  let greatest = start;
  let place = start;
  let turn = 0;
  for (const value of view) {
    turn += 2;
    if (value > greatest) {
      greatest = value;
      place = turn;
    }
  }
  return greatest + "," + place;
}
function filledUint8Array(length: number, step: number): Uint8Array {
  const view = new Uint8Array(length);
  for (let index = 0; index < length; index++) view[index] = (index * step + 3) % 11;
  return view;
}
function placeOfGreatestInUint8Array(view: Uint8Array, start: number): string {
  let greatest = start;
  let place = start;
  let turn = -1;
  for (const value of view) {
    turn++;
    if (value > greatest) {
      greatest = value;
      place = turn;
    }
  }
  return greatest + "," + place;
}
function lastPlaceAboveInUint8Array(view: Uint8Array, limit: number): number {
  let place = -5;
  let turn = 1;
  for (const value of view) {
    turn++;
    if (value > limit) place = turn;
  }
  return place;
}
function placeCountedByTwoInUint8Array(view: Uint8Array, start: number): string {
  let greatest = start;
  let place = start;
  let turn = 0;
  for (const value of view) {
    turn += 2;
    if (value > greatest) {
      greatest = value;
      place = turn;
    }
  }
  return greatest + "," + place;
}
function filledInt32Array(length: number, step: number): Int32Array {
  const view = new Int32Array(length);
  for (let index = 0; index < length; index++) view[index] = (index * step + 3) % 11;
  return view;
}
function placeOfGreatestInInt32Array(view: Int32Array, start: number): string {
  let greatest = start;
  let place = start;
  let turn = -1;
  for (const value of view) {
    turn++;
    if (value > greatest) {
      greatest = value;
      place = turn;
    }
  }
  return greatest + "," + place;
}
function lastPlaceAboveInInt32Array(view: Int32Array, limit: number): number {
  let place = -5;
  let turn = 1;
  for (const value of view) {
    turn++;
    if (value > limit) place = turn;
  }
  return place;
}
function placeCountedByTwoInInt32Array(view: Int32Array, start: number): string {
  let greatest = start;
  let place = start;
  let turn = 0;
  for (const value of view) {
    turn += 2;
    if (value > greatest) {
      greatest = value;
      place = turn;
    }
  }
  return greatest + "," + place;
}
for (const length of [0, 1, 7, 8, 9, 15, 16, 17, 24, 25, 78]) {
  console.log(
    "Int16Array",
    length,
    placeOfGreatestInInt16Array(new Int16Array(length), 0),
    placeOfGreatestInInt16Array(filledInt16Array(length, 7), 0),
    lastPlaceAboveInInt16Array(new Int16Array(length), 0),
    lastPlaceAboveInInt16Array(filledInt16Array(length, 7), 8),
    placeCountedByTwoInInt16Array(new Int16Array(length), 0),
    placeCountedByTwoInInt16Array(filledInt16Array(length, 5), 0),
  );
  console.log(
    "Float64Array",
    length,
    placeOfGreatestInFloat64Array(new Float64Array(length), 0),
    placeOfGreatestInFloat64Array(filledFloat64Array(length, 7), 0),
    lastPlaceAboveInFloat64Array(new Float64Array(length), 0),
    lastPlaceAboveInFloat64Array(filledFloat64Array(length, 7), 8),
    placeCountedByTwoInFloat64Array(new Float64Array(length), 0),
    placeCountedByTwoInFloat64Array(filledFloat64Array(length, 5), 0),
  );
  console.log(
    "Uint8Array",
    length,
    placeOfGreatestInUint8Array(new Uint8Array(length), 0),
    placeOfGreatestInUint8Array(filledUint8Array(length, 7), 0),
    lastPlaceAboveInUint8Array(new Uint8Array(length), 0),
    lastPlaceAboveInUint8Array(filledUint8Array(length, 7), 8),
    placeCountedByTwoInUint8Array(new Uint8Array(length), 0),
    placeCountedByTwoInUint8Array(filledUint8Array(length, 5), 0),
  );
  console.log(
    "Int32Array",
    length,
    placeOfGreatestInInt32Array(new Int32Array(length), 0),
    placeOfGreatestInInt32Array(filledInt32Array(length, 7), 0),
    lastPlaceAboveInInt32Array(new Int32Array(length), 0),
    lastPlaceAboveInInt32Array(filledInt32Array(length, 7), 8),
    placeCountedByTwoInInt32Array(new Int32Array(length), 0),
    placeCountedByTwoInInt32Array(filledInt32Array(length, 5), 0),
  );
}
