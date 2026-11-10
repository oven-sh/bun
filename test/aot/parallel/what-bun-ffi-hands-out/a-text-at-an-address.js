// CString, called or constructed, answers a text and no object.
import { CString, ptr } from "bun:ffi";

const bytes = new Uint8Array([119, 111, 114, 100, 115, 0, 109, 111, 114, 101, 0]);
const address = ptr(bytes);
const whole = new CString(address);
console.log(typeof whole, whole, String(whole.length), String(whole === "words"));
console.log(new CString(address, 6), new CString(address, 1, 3), CString(address, 6, 2));
console.log(
  JSON.stringify(new CString(0)),
  typeof new CString(0),
  typeof CString,
  String(CString.length),
  CString.name,
);
console.log(`${new CString(address)} and ${new CString(address, 6)}`.toUpperCase());
