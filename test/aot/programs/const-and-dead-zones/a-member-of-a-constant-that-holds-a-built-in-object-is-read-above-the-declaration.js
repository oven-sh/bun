// A member read on a constant throws above the declaration of the constant, also where the constant holds a built-in object and nobody uses the member.
function ending(f) {
  try {
    f();
    console.log("completes");
  } catch (error) {
    console.log("throws", error.constructor.name);
  }
}
ending(() => {
  late.keys;
});
ending(() => {
  void late.keys;
});
ending(() => {
  late["keys"];
});
ending(() => {
  const unused = late.keys;
});
ending(() => {
  return lateMember;
});
const late = Object;
const lateMember = Object.keys;
ending(() => {
  late.keys;
});
