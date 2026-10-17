const parent = { shared: 7 };
let fillers = 0;
const kept = [];
function makeOtherShapes(count) {
  for (let i = 0; i < count; i++) {
    const other = {};
    other["filler" + fillers++] = 1;
    kept.push(other);
  }
}
function make(length, shapes, create, otherShapesBetween = 0) {
  const list = [];
  for (let i = 0; i < length; i++) {
    const object = create();
    object.value = i + 1;
    object["only" + (i % shapes)] = true;
    list.push(object);
    if (i < shapes) makeOtherShapes(otherShapesBetween);
  }
  return list;
}
export const plain = (shapes, otherShapesBetween) => make(8, shapes, () => ({}), otherShapesBetween);
export const heirs = (shapes, otherShapesBetween) => make(8, shapes, () => Object.create(parent), otherShapesBetween);
export const plainOfEveryShape = shapes => make(shapes, shapes, () => ({}));
export const heirsOfEveryShape = shapes => make(shapes, shapes, () => Object.create(parent));
export const wide = shapes =>
  make(8, shapes, () => {
    const object = {};
    for (let i = 0; i < 40; i++) object["p" + (i < 10 ? "0" : "") + i] = i;
    return object;
  });
export function emptyLoop(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) if (list[i & 7] !== undefined) s++;
  return s;
}
export function readPresent(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += list[i & 7].value;
  return s;
}
export function readAbsent(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) if (list[i & 7].missing === undefined) s++;
  return s;
}
export function readInherited(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += list[i & 7].shared;
  return s;
}
let next = 0;
export function passWithoutReads(list, n) {
  let s = 0;
  for (let i = 0; i < n * 16; i++) if (list[next++ & 1023] !== undefined) s++;
  return s;
}
export function readPresentOfAll(list, n) {
  let s = 0;
  for (let i = 0; i < n * 16; i++) s += list[next++ & 1023].value;
  return s;
}
export function readAbsentOfAll(list, n) {
  let s = 0;
  for (let i = 0; i < n * 16; i++) if (list[next++ & 1023].missing === undefined) s++;
  return s;
}
export function readInheritedOfAll(list, n) {
  let s = 0;
  for (let i = 0; i < n * 16; i++) s += list[next++ & 1023].shared;
  return s;
}
export function readFiveNames(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < 6; j++) {
      const object = list[j];
      if (object.value !== undefined) s++;
      if (object.missing === undefined) s++;
      if (object.shared !== undefined) s++;
      if (object.only0 !== undefined) s++;
      if (object.toString !== undefined) s++;
    }
  return s;
}
export function readFortyPresent(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const object = list[i & 7];
    if (object.p00 !== undefined) s++;
    if (object.p01 !== undefined) s++;
    if (object.p02 !== undefined) s++;
    if (object.p03 !== undefined) s++;
    if (object.p04 !== undefined) s++;
    if (object.p05 !== undefined) s++;
    if (object.p06 !== undefined) s++;
    if (object.p07 !== undefined) s++;
    if (object.p08 !== undefined) s++;
    if (object.p09 !== undefined) s++;
    if (object.p10 !== undefined) s++;
    if (object.p11 !== undefined) s++;
    if (object.p12 !== undefined) s++;
    if (object.p13 !== undefined) s++;
    if (object.p14 !== undefined) s++;
    if (object.p15 !== undefined) s++;
    if (object.p16 !== undefined) s++;
    if (object.p17 !== undefined) s++;
    if (object.p18 !== undefined) s++;
    if (object.p19 !== undefined) s++;
    if (object.p20 !== undefined) s++;
    if (object.p21 !== undefined) s++;
    if (object.p22 !== undefined) s++;
    if (object.p23 !== undefined) s++;
    if (object.p24 !== undefined) s++;
    if (object.p25 !== undefined) s++;
    if (object.p26 !== undefined) s++;
    if (object.p27 !== undefined) s++;
    if (object.p28 !== undefined) s++;
    if (object.p29 !== undefined) s++;
    if (object.p30 !== undefined) s++;
    if (object.p31 !== undefined) s++;
    if (object.p32 !== undefined) s++;
    if (object.p33 !== undefined) s++;
    if (object.p34 !== undefined) s++;
    if (object.p35 !== undefined) s++;
    if (object.p36 !== undefined) s++;
    if (object.p37 !== undefined) s++;
    if (object.p38 !== undefined) s++;
    if (object.p39 !== undefined) s++;
  }
  return s;
}
export function readFortyAbsent(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const object = list[i & 7];
    if (object.q00 === undefined) s++;
    if (object.q01 === undefined) s++;
    if (object.q02 === undefined) s++;
    if (object.q03 === undefined) s++;
    if (object.q04 === undefined) s++;
    if (object.q05 === undefined) s++;
    if (object.q06 === undefined) s++;
    if (object.q07 === undefined) s++;
    if (object.q08 === undefined) s++;
    if (object.q09 === undefined) s++;
    if (object.q10 === undefined) s++;
    if (object.q11 === undefined) s++;
    if (object.q12 === undefined) s++;
    if (object.q13 === undefined) s++;
    if (object.q14 === undefined) s++;
    if (object.q15 === undefined) s++;
    if (object.q16 === undefined) s++;
    if (object.q17 === undefined) s++;
    if (object.q18 === undefined) s++;
    if (object.q19 === undefined) s++;
    if (object.q20 === undefined) s++;
    if (object.q21 === undefined) s++;
    if (object.q22 === undefined) s++;
    if (object.q23 === undefined) s++;
    if (object.q24 === undefined) s++;
    if (object.q25 === undefined) s++;
    if (object.q26 === undefined) s++;
    if (object.q27 === undefined) s++;
    if (object.q28 === undefined) s++;
    if (object.q29 === undefined) s++;
    if (object.q30 === undefined) s++;
    if (object.q31 === undefined) s++;
    if (object.q32 === undefined) s++;
    if (object.q33 === undefined) s++;
    if (object.q34 === undefined) s++;
    if (object.q35 === undefined) s++;
    if (object.q36 === undefined) s++;
    if (object.q37 === undefined) s++;
    if (object.q38 === undefined) s++;
    if (object.q39 === undefined) s++;
  }
  return s;
}
