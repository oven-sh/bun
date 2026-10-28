// One function stores to the static field `held` of whichever of two classes it is handed. One class gets a member of the enum, the other 2 ** 31.
enum Mode {
  Off,
  On,
}
class Left {
  static held: Mode = Mode.On;
}
class Right {
  static held: Mode = Mode.Off;
}
function put(holder: typeof Left | typeof Right, v: Mode) {
  holder.held = v;
}
const wide: number = 2 ** 31;
put(Left, Mode.Off);
put(Right, wide);
console.log(Left.held, Right.held, typeof Right.held);
