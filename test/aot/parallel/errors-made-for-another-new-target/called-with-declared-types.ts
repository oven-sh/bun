// An error that a constructor of the engine makes for another new.target leaves out the frames down to the function that is new.target.
// The function is called, and its parameters have declared types.
function Kept(this: any, text: string) {
  const made = Reflect.construct(Error, [text], new.target ?? Kept);
  return made;
}
Kept.prototype = Object.create(Error.prototype);
const error = (Kept as any)("a");
console.log(typeof error.stack, error instanceof Kept, error.message);
