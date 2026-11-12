// RUN(INFERRED): link
// INFERRED: layout {{*}}fields=[{key="radius"
// INFERRED-NOT: supertypes=
// INFERRED: layout

// RUN(WRITTEN): link
// WRITTEN-NOT: layout {{*}}key="depth"

// RUN(CONSTRUCTED): link
// CONSTRUCTED: layout {{*}}fields=[{key="border"
// CONSTRUCTED-NOT: supertypes=
// CONSTRUCTED: layout

// RUN(FORWARDED): link
// FORWARDED: layout {{*}}fields=[{key="long"
// FORWARDED-NOT: supertypes=
// FORWARDED: layout

// RUN(EXTENDED): link
// EXTENDED: layout {{*}}fields=[{key="plain"{{*}}supertypes=[{{*}}[[shape]]]
// EXTENDED: function {{*}}name="Holder" module={{*}}parameters=[{type=undefined|null|[[shape]] flags=[OmitsNull, OmitsUndefined]}]

// RUN(MENTIONED): link
// MENTIONED: layout {{*}}fields=[{key="glaze"{{*}}supertypes=[{{*}}[[shape]]]
// MENTIONED: function {{*}}name="Holder" module={{*}}parameters=[{type=undefined|null|[[shape]] flags=[OmitsNull, OmitsUndefined]}]

// RUN(SPREAD): link
// SPREAD: layout {{*}}fields=[{key="hole"
// SPREAD-NOT: supertypes=
// SPREAD: layout

// RUN(ARCH): link
// ARCH: layout {{*}}fields=[{key="bend"
// ARCH-NOT: supertypes=
// ARCH: layout

// RUN(WEDGE): link
// WEDGE: layout {{*}}fields=[{key="angle"
// WEDGE-NOT: supertypes=
// WEDGE: layout

// RUN(OTHERS): link
// OTHERS-NOT: layout {{*}}key="strange"{{*}}supertypes=

// A position that is written `T extends Shape` has the type of the bound, so it is tested for the layouts below Shape. What the program writes in the place of `T` in the type of an instance is one of them: where a class extends a generic class, and where the type of a parameter names one. What a call or a construction puts in the place of `T` is below nothing: a type argument that the checker infers, also from the contents of an array, as a union of two or for a call with a spread, and the bound of another type parameter that stands in the place of `T`. One that a call writes and that no argument brings is not even looked at. A value of such a type fails the test for Shape, and the closed arm takes it. What is put in the place of a type parameter without a bound is below nothing.
interface Arch {
  bend: number;
  side: number;
}

interface Circle {
  radius: number;
  side: number;
}

interface Disk {
  depth: number;
  side: number;
}

interface Frame {
  border: number;
  side: number;
}

interface Oval {
  long: number;
  side: number;
}

interface Plate {
  plain: number;
  side: number;
}

interface Ring {
  hole: number;
  side: number;
}

interface Shape {
  side: number;
}

interface Stranger {
  side: number;
  strange: number;
}

interface Tile {
  glaze: number;
  side: number;
}

interface Wedge {
  angle: number;
  side: number;
}

class Holder<T extends Shape> {
  held: T;

  constructor(held: T) {
    this.held = held;
  }
}

export class Plates extends Holder<Plate> {}

function create<T extends Shape>(): T | undefined {
  return undefined;
}

function keep<T extends Shape>(value: T) {
  return value;
}

function largest<T extends Shape>(list: T[]): T {
  return list[0];
}

function wrap<T>(value: T) {
  return value;
}

export function construct(frame: Frame) {
  return new Holder(frame);
}

export function forward<U extends Oval>(value: U) {
  return keep(value);
}

export function infer(circles: Circle[]) {
  return largest(circles);
}

export function mention(plate: Plate) {
  return plate.plain;
}

export function mix(shapes: (Arch | Wedge)[]) {
  return largest(shapes);
}

export function read(holder: Holder<Tile>) {
  return holder.held;
}

export function spread(rings: [Ring[]]) {
  return largest(...rings);
}

export function unbounded(stranger: Stranger) {
  return wrap(stranger);
}

export function write() {
  return create<Disk>();
}
