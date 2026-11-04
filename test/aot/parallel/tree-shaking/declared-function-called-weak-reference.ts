// The program makes a weak reference, and most of its functions are only ever called. No function object is made for those. The ones that are used as values stay what they are: the target of the weak reference, an argument, a property, an element.
function outputPath(id: string): string {
  return root + "/" + id + ".out";
}
function describe(id: string, size: number): string {
  return outputPath(id) + " (" + double(size) + ")";
}
function double(n: number): number {
  return n * 2;
}
function watched(n: number): number {
  return n + 1;
}
function passedOn(n: number): number {
  return n + 10;
}
function stored(n: number): number {
  return n + 100;
}
function listed(n: number): number {
  return n + 1000;
}
const root = "/tmp/tasks";
const reference = new WeakRef(watched);
const holder = { run: stored };
const list = [listed];
console.log(describe("a", 4), describe("b", 5));
console.log(reference.deref() === watched, reference.deref()!(1), reference.deref()!.name, watched.length);
console.log([1, 2, 3].map(passedOn).join(), holder.run(1), holder.run === stored, list[0](1), list.includes(listed));
