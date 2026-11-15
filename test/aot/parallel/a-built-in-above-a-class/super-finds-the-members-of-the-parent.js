function make(Parent) { return class extends Parent { toString() { return "below " + super.toString(); } static where() { return typeof super.captureStackTrace; } }; }
const D = make({ held: Error }.held); console.log(String(new D("made up")), D.where());
