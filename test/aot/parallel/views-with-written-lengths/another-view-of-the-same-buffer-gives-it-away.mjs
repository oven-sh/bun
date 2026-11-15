function at4(view) { return view[4]; } function tell(view) { try { return String(at4(view)) + " " + view.length; } catch (error) { return error.constructor.name; } }
const view = new Int32Array(8); const other = new Uint8Array(view.buffer); console.log(tell(view)); other.buffer.transfer(); console.log(tell(view));
