// An object of a class two steps below the class that is asked for: its shape says yes.
// STATISTIC: MissesOfInstanceOfAnsweredByShapesOfKin >= 1
const kinds = JSON.parse('["click","key","touch","scroll","pen","click","key"]');
class UiEvent { constructor(x) { this.x = x; } }
class PointerEvent extends UiEvent {}
class ClickEvent extends PointerEvent {}
class TouchEvent extends PointerEvent { constructor(x) { super(x); this.fingers = 2; } }
class PenEvent extends TouchEvent {}
class KeyEvent extends UiEvent {}
class ScrollEvent extends UiEvent {}
const makers = { click: ClickEvent, key: KeyEvent, touch: TouchEvent, scroll: ScrollEvent, pen: PenEvent };
const events = kinds.map((kind, i) => new makers[kind](i + 1));
function count() {
  let pointers = 0, touches = 0, all = 0, keys = 0;
  for (const event of events) {
    if (event instanceof PointerEvent) pointers += event.x;
    if (event instanceof TouchEvent) touches += event.x;
    if (event instanceof UiEvent) all += event.x;
    if (event instanceof KeyEvent) keys += event.x;
  }
  return [pointers, touches, all, keys].join();
}
let last = "";
for (let turn = 0; turn < 30; turn++) last = count();
console.log(last);
