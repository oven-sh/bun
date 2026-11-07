// The own properties of a prototype object of the host are laid on a new object by their descriptions. What describes a property of the copy holds the function that the source has.
function getterOfCopy() {
  const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(ReadableStreamDefaultReader.prototype));
  const description = Object.getOwnPropertyDescriptor(copy, "closed");
  return { get: description.get };
}
console.log(typeof getterOfCopy().get);
