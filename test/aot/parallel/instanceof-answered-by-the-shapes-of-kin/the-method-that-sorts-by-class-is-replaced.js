// The method that sorts by class is replaced between two turns of the loop that calls it.
const rows = JSON.parse('[{"kind":"click","x":1,"key":"a"},{"kind":"key","x":2,"key":"bc"},{"kind":"scroll","x":3,"key":"d"},{"kind":"touch","x":4,"key":"e"},{"kind":"custom","x":5,"key":"fgh"}]');
class UiEvent { constructor(row) { this.x = row.x; this.handled = false; } }
class PointerEvent extends UiEvent { get y() { return this.x * 2; } }
class ClickEvent extends PointerEvent {}
class TouchEvent extends PointerEvent { constructor(row) { super(row); this.fingers = 2; } }
class KeyEvent extends UiEvent { constructor(row) { super(row); this.key = row.key; } }
class ScrollEvent extends UiEvent {}
class CustomEvent extends UiEvent { constructor(row) { super(row); this.detail = { key: row.key }; } }
const kinds = { click: ClickEvent, key: KeyEvent, scroll: ScrollEvent, touch: TouchEvent, custom: CustomEvent };
class Handler {
  weigh(event) {
    if (event instanceof TouchEvent) return event.fingers * event.x;
    if (event instanceof PointerEvent) return event.y;
    if (event instanceof KeyEvent) return event.key.length;
    if (event instanceof ScrollEvent) return -event.x;
    return event.detail.key.length * 2;
  }
}
const data = { handler: new Handler(), events: rows.map(row => new kinds[row.kind](row)) };
function turn(d, t) {
  let total = 0;
  for (const event of d.events) { total += d.handler.weigh(event); event.handled = !event.handled; }
  return total + (t & 3);
}
const said = [];
for (let t = 0; t < 44; t++) {
  if (t === 20) { data.events[2].key = "scrolled"; Object.setPrototypeOf(ScrollEvent.prototype, KeyEvent.prototype); }
  if (t === 30) Handler.prototype.weigh = function (event) { return event instanceof UiEvent ? 7 : 0; };
  if (t === 36) data.events.push({ x: 9, detail: { key: "plain" } });
  said.push(turn(data, t));
}
console.log(said.join());
