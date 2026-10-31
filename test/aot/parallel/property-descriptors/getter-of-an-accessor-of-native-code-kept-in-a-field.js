// Native code keeps `isTrusted` of an event behind an accessor of its own. What describes the property holds its getter, which is kept in the field of a literal and read again.
function getterOfEvent() {
  const description = Object.getOwnPropertyDescriptor(new Event("kind"), "isTrusted");
  return { get: description.get };
}
console.log(typeof getterOfEvent().get);
