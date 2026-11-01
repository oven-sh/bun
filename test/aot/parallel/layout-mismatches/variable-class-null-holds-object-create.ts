// A variable of type `Point | null` only ever holds null or what Object.create(Point.prototype) made. Each function tells null apart in its own way and then reads a member that Point does not declare.
class Point {}
let held: Point | null = null;
function strictlyNull(): number {
  const it = held;
  if (it === null) return 0;
  return (it as any).missing === undefined ? 1 : 2;
}
function notNull(): number {
  const it = held;
  if (it !== null) return (it as any).missing === undefined ? 1 : 2;
  return 0;
}
function looselyNull(): number {
  const it = held;
  if (it == null) return 0;
  return (it as any).missing === undefined ? 1 : 2;
}
function truthy(): number {
  const it = held;
  if (!it) return 0;
  return (it as any).missing === undefined ? 1 : 2;
}
function notUndefined(): number {
  const it = held;
  if (it === undefined) return 0;
  return (it as any) === null ? 1 : 2;
}
function conditional(): number {
  const it = held;
  return it === null ? 0 : (it as any).missing === undefined ? 1 : 2;
}
function inALoop(): number {
  let count = 0;
  for (let it = held; it !== null; it = (it as any).next ?? null) count += (it as any).weight ?? 10;
  return count;
}
function counter() {
  let captured: Point | null = null;
  return {
    fill() {
      captured = Object.create(Point.prototype);
    },
    look(): number {
      const it = captured;
      if (it === null) return 0;
      return (it as any).missing === undefined ? 1 : 2;
    },
  };
}
const all = [strictlyNull, notNull, looselyNull, truthy, notUndefined, conditional, inALoop];
const one = counter();
console.log(all.map(look => look()).join(), one.look());
held = Object.create(Point.prototype);
one.fill();
console.log(all.map(look => look()).join(), one.look());
(held as any).missing = 1;
(held as any).weight = 3;
(held as any).next = Object.create(Point.prototype);
console.log(all.map(look => look()).join(), one.look());
