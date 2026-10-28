// Every accessor of a public class (255) read and stored on an object that only inherits from the prototype object, and its getter called by hand on a literal: nearly all throw, a few answer undefined, and a store through three of them defines an own property.
function attempt(label, run) {
  try { run(); } catch (error) { console.log(label, "throws", error.constructor.name); }
}
attempt("AbortSignal.prototype.aborted of an heir", () => {
  const heir = Object.create(AbortSignal.prototype);
  const value = heir.aborted;
  console.log("AbortSignal.prototype.aborted of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("AbortSignal.prototype.aborted by hand", () => {
  const value = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted").get.call({ plain: true });
  console.log("AbortSignal.prototype.aborted by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("ArrayBuffer.prototype.byteLength of an heir", () => {
  const heir = Object.create(ArrayBuffer.prototype);
  const value = heir.byteLength;
  console.log("ArrayBuffer.prototype.byteLength of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("ArrayBuffer.prototype.byteLength by hand", () => {
  const value = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get.call({ plain: true });
  console.log("ArrayBuffer.prototype.byteLength by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("ArrayBuffer.prototype.detached of an heir", () => {
  const heir = Object.create(ArrayBuffer.prototype);
  const value = heir.detached;
  console.log("ArrayBuffer.prototype.detached of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("ArrayBuffer.prototype.detached by hand", () => {
  const value = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "detached").get.call({ plain: true });
  console.log("ArrayBuffer.prototype.detached by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("ArrayBuffer.prototype.maxByteLength of an heir", () => {
  const heir = Object.create(ArrayBuffer.prototype);
  const value = heir.maxByteLength;
  console.log("ArrayBuffer.prototype.maxByteLength of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("ArrayBuffer.prototype.maxByteLength by hand", () => {
  const value = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "maxByteLength").get.call({ plain: true });
  console.log("ArrayBuffer.prototype.maxByteLength by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("ArrayBuffer.prototype.resizable of an heir", () => {
  const heir = Object.create(ArrayBuffer.prototype);
  const value = heir.resizable;
  console.log("ArrayBuffer.prototype.resizable of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("ArrayBuffer.prototype.resizable by hand", () => {
  const value = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable").get.call({ plain: true });
  console.log("ArrayBuffer.prototype.resizable by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("AsyncDisposableStack.prototype.disposed of an heir", () => {
  const heir = Object.create(AsyncDisposableStack.prototype);
  const value = heir.disposed;
  console.log("AsyncDisposableStack.prototype.disposed of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("AsyncDisposableStack.prototype.disposed by hand", () => {
  const value = Object.getOwnPropertyDescriptor(AsyncDisposableStack.prototype, "disposed").get.call({ plain: true });
  console.log("AsyncDisposableStack.prototype.disposed by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Blob.prototype.lastModified of an heir", () => {
  const heir = Object.create(Blob.prototype);
  const value = heir.lastModified;
  console.log("Blob.prototype.lastModified of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Blob.prototype.lastModified by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Blob.prototype, "lastModified").get.call({ plain: true });
  console.log("Blob.prototype.lastModified by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Blob.prototype.name of an heir", () => {
  const heir = Object.create(Blob.prototype);
  const value = heir.name;
  console.log("Blob.prototype.name of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Blob.prototype.name by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Blob.prototype, "name").get.call({ plain: true });
  console.log("Blob.prototype.name by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Blob.prototype.name stored on an heir", () => {
  const heir = Object.create(Blob.prototype);
  heir.name = "stored";
  console.log("Blob.prototype.name stored on an heir", Object.keys(heir).join(), Object.hasOwn(heir, "name"));
});
attempt("Blob.prototype.size of an heir", () => {
  const heir = Object.create(Blob.prototype);
  const value = heir.size;
  console.log("Blob.prototype.size of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Blob.prototype.size by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Blob.prototype, "size").get.call({ plain: true });
  console.log("Blob.prototype.size by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Blob.prototype.type of an heir", () => {
  const heir = Object.create(Blob.prototype);
  const value = heir.type;
  console.log("Blob.prototype.type of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Blob.prototype.type by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Blob.prototype, "type").get.call({ plain: true });
  console.log("Blob.prototype.type by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Buffer.prototype.offset of an heir", () => {
  const heir = Object.create(Buffer.prototype);
  const value = heir.offset;
  console.log("Buffer.prototype.offset of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Buffer.prototype.offset by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Buffer.prototype, "offset").get.call({ plain: true });
  console.log("Buffer.prototype.offset by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Buffer.prototype.parent of an heir", () => {
  const heir = Object.create(Buffer.prototype);
  const value = heir.parent;
  console.log("Buffer.prototype.parent of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Buffer.prototype.parent by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Buffer.prototype, "parent").get.call({ plain: true });
  console.log("Buffer.prototype.parent by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("BuildMessage.prototype.column of an heir", () => {
  const heir = Object.create(BuildMessage.prototype);
  const value = heir.column;
  console.log("BuildMessage.prototype.column of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("BuildMessage.prototype.column by hand", () => {
  const value = Object.getOwnPropertyDescriptor(BuildMessage.prototype, "column").get.call({ plain: true });
  console.log("BuildMessage.prototype.column by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("BuildMessage.prototype.level of an heir", () => {
  const heir = Object.create(BuildMessage.prototype);
  const value = heir.level;
  console.log("BuildMessage.prototype.level of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("BuildMessage.prototype.level by hand", () => {
  const value = Object.getOwnPropertyDescriptor(BuildMessage.prototype, "level").get.call({ plain: true });
  console.log("BuildMessage.prototype.level by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("BuildMessage.prototype.line of an heir", () => {
  const heir = Object.create(BuildMessage.prototype);
  const value = heir.line;
  console.log("BuildMessage.prototype.line of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("BuildMessage.prototype.line by hand", () => {
  const value = Object.getOwnPropertyDescriptor(BuildMessage.prototype, "line").get.call({ plain: true });
  console.log("BuildMessage.prototype.line by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("BuildMessage.prototype.message of an heir", () => {
  const heir = Object.create(BuildMessage.prototype);
  const value = heir.message;
  console.log("BuildMessage.prototype.message of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("BuildMessage.prototype.message by hand", () => {
  const value = Object.getOwnPropertyDescriptor(BuildMessage.prototype, "message").get.call({ plain: true });
  console.log("BuildMessage.prototype.message by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("BuildMessage.prototype.message stored on an heir", () => {
  const heir = Object.create(BuildMessage.prototype);
  heir.message = "stored";
  console.log("BuildMessage.prototype.message stored on an heir", Object.keys(heir).join(), Object.hasOwn(heir, "message"));
});
attempt("BuildMessage.prototype.notes of an heir", () => {
  const heir = Object.create(BuildMessage.prototype);
  const value = heir.notes;
  console.log("BuildMessage.prototype.notes of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("BuildMessage.prototype.notes by hand", () => {
  const value = Object.getOwnPropertyDescriptor(BuildMessage.prototype, "notes").get.call({ plain: true });
  console.log("BuildMessage.prototype.notes by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("BuildMessage.prototype.position of an heir", () => {
  const heir = Object.create(BuildMessage.prototype);
  const value = heir.position;
  console.log("BuildMessage.prototype.position of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("BuildMessage.prototype.position by hand", () => {
  const value = Object.getOwnPropertyDescriptor(BuildMessage.prototype, "position").get.call({ plain: true });
  console.log("BuildMessage.prototype.position by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Crypto.prototype.subtle of an heir", () => {
  const heir = Object.create(Crypto.prototype);
  const value = heir.subtle;
  console.log("Crypto.prototype.subtle of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Crypto.prototype.subtle by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Crypto.prototype, "subtle").get.call({ plain: true });
  console.log("Crypto.prototype.subtle by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Crypto.prototype.subtle stored on an heir", () => {
  const heir = Object.create(Crypto.prototype);
  heir.subtle = "stored";
  console.log("Crypto.prototype.subtle stored on an heir", Object.keys(heir).join(), Object.hasOwn(heir, "subtle"));
});
attempt("DataView.prototype.buffer of an heir", () => {
  const heir = Object.create(DataView.prototype);
  const value = heir.buffer;
  console.log("DataView.prototype.buffer of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("DataView.prototype.buffer by hand", () => {
  const value = Object.getOwnPropertyDescriptor(DataView.prototype, "buffer").get.call({ plain: true });
  console.log("DataView.prototype.buffer by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("DataView.prototype.byteLength of an heir", () => {
  const heir = Object.create(DataView.prototype);
  const value = heir.byteLength;
  console.log("DataView.prototype.byteLength of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("DataView.prototype.byteLength by hand", () => {
  const value = Object.getOwnPropertyDescriptor(DataView.prototype, "byteLength").get.call({ plain: true });
  console.log("DataView.prototype.byteLength by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("DataView.prototype.byteOffset of an heir", () => {
  const heir = Object.create(DataView.prototype);
  const value = heir.byteOffset;
  console.log("DataView.prototype.byteOffset of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("DataView.prototype.byteOffset by hand", () => {
  const value = Object.getOwnPropertyDescriptor(DataView.prototype, "byteOffset").get.call({ plain: true });
  console.log("DataView.prototype.byteOffset by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("DisposableStack.prototype.disposed of an heir", () => {
  const heir = Object.create(DisposableStack.prototype);
  const value = heir.disposed;
  console.log("DisposableStack.prototype.disposed of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("DisposableStack.prototype.disposed by hand", () => {
  const value = Object.getOwnPropertyDescriptor(DisposableStack.prototype, "disposed").get.call({ plain: true });
  console.log("DisposableStack.prototype.disposed by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Event.prototype.bubbles of an heir", () => {
  const heir = Object.create(Event.prototype);
  const value = heir.bubbles;
  console.log("Event.prototype.bubbles of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Event.prototype.bubbles by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Event.prototype, "bubbles").get.call({ plain: true });
  console.log("Event.prototype.bubbles by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Event.prototype.cancelable of an heir", () => {
  const heir = Object.create(Event.prototype);
  const value = heir.cancelable;
  console.log("Event.prototype.cancelable of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Event.prototype.cancelable by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Event.prototype, "cancelable").get.call({ plain: true });
  console.log("Event.prototype.cancelable by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Event.prototype.composed of an heir", () => {
  const heir = Object.create(Event.prototype);
  const value = heir.composed;
  console.log("Event.prototype.composed of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Event.prototype.composed by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Event.prototype, "composed").get.call({ plain: true });
  console.log("Event.prototype.composed by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Event.prototype.defaultPrevented of an heir", () => {
  const heir = Object.create(Event.prototype);
  const value = heir.defaultPrevented;
  console.log("Event.prototype.defaultPrevented of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Event.prototype.defaultPrevented by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Event.prototype, "defaultPrevented").get.call({ plain: true });
  console.log("Event.prototype.defaultPrevented by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Event.prototype.eventPhase of an heir", () => {
  const heir = Object.create(Event.prototype);
  const value = heir.eventPhase;
  console.log("Event.prototype.eventPhase of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Event.prototype.eventPhase by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Event.prototype, "eventPhase").get.call({ plain: true });
  console.log("Event.prototype.eventPhase by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Event.prototype.type of an heir", () => {
  const heir = Object.create(Event.prototype);
  const value = heir.type;
  console.log("Event.prototype.type of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Event.prototype.type by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Event.prototype, "type").get.call({ plain: true });
  console.log("Event.prototype.type by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Function.prototype.arguments of an heir", () => {
  const heir = Object.create(Function.prototype);
  const value = heir.arguments;
  console.log("Function.prototype.arguments of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Function.prototype.arguments by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Function.prototype, "arguments").get.call({ plain: true });
  console.log("Function.prototype.arguments by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Function.prototype.arguments stored on an heir", () => {
  const heir = Object.create(Function.prototype);
  heir.arguments = "stored";
  console.log("Function.prototype.arguments stored on an heir", Object.keys(heir).join(), Object.hasOwn(heir, "arguments"));
});
attempt("Function.prototype.caller of an heir", () => {
  const heir = Object.create(Function.prototype);
  const value = heir.caller;
  console.log("Function.prototype.caller of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Function.prototype.caller by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Function.prototype, "caller").get.call({ plain: true });
  console.log("Function.prototype.caller by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Function.prototype.caller stored on an heir", () => {
  const heir = Object.create(Function.prototype);
  heir.caller = "stored";
  console.log("Function.prototype.caller stored on an heir", Object.keys(heir).join(), Object.hasOwn(heir, "caller"));
});
attempt("Headers.prototype.count of an heir", () => {
  const heir = Object.create(Headers.prototype);
  const value = heir.count;
  console.log("Headers.prototype.count of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Headers.prototype.count by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Headers.prototype, "count").get.call({ plain: true });
  console.log("Headers.prototype.count by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Iterator.prototype.constructor of an heir", () => {
  const heir = Object.create(Iterator.prototype);
  const value = heir.constructor;
  console.log("Iterator.prototype.constructor of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Iterator.prototype.constructor by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Iterator.prototype, "constructor").get.call({ plain: true });
  console.log("Iterator.prototype.constructor by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Iterator.prototype.constructor stored on an heir", () => {
  const heir = Object.create(Iterator.prototype);
  heir.constructor = "stored";
  console.log("Iterator.prototype.constructor stored on an heir", Object.keys(heir).join(), Object.hasOwn(heir, "constructor"));
});
attempt("Map.prototype.size of an heir", () => {
  const heir = Object.create(Map.prototype);
  const value = heir.size;
  console.log("Map.prototype.size of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Map.prototype.size by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Map.prototype, "size").get.call({ plain: true });
  console.log("Map.prototype.size by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Object.prototype.__proto__ of an heir", () => {
  const heir = Object.create(Object.prototype);
  const value = heir.__proto__;
  console.log("Object.prototype.__proto__ of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Object.prototype.__proto__ by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").get.call({ plain: true });
  console.log("Object.prototype.__proto__ by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Object.prototype.__proto__ stored on an heir", () => {
  const heir = Object.create(Object.prototype);
  heir.__proto__ = "stored";
  console.log("Object.prototype.__proto__ stored on an heir", Object.keys(heir).join(), Object.hasOwn(heir, "__proto__"));
});
attempt("Performance.prototype.onresourcetimingbufferfull of an heir", () => {
  const heir = Object.create(Performance.prototype);
  const value = heir.onresourcetimingbufferfull;
  console.log("Performance.prototype.onresourcetimingbufferfull of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Performance.prototype.onresourcetimingbufferfull by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Performance.prototype, "onresourcetimingbufferfull").get.call({ plain: true });
  console.log("Performance.prototype.onresourcetimingbufferfull by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Performance.prototype.onresourcetimingbufferfull stored on an heir", () => {
  const heir = Object.create(Performance.prototype);
  heir.onresourcetimingbufferfull = "stored";
  console.log("Performance.prototype.onresourcetimingbufferfull stored on an heir", Object.keys(heir).join(), Object.hasOwn(heir, "onresourcetimingbufferfull"));
});
attempt("Performance.prototype.timeOrigin of an heir", () => {
  const heir = Object.create(Performance.prototype);
  const value = heir.timeOrigin;
  console.log("Performance.prototype.timeOrigin of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Performance.prototype.timeOrigin by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Performance.prototype, "timeOrigin").get.call({ plain: true });
  console.log("Performance.prototype.timeOrigin by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Performance.prototype.timing of an heir", () => {
  const heir = Object.create(Performance.prototype);
  const value = heir.timing;
  console.log("Performance.prototype.timing of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Performance.prototype.timing by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Performance.prototype, "timing").get.call({ plain: true });
  console.log("Performance.prototype.timing by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("RegExp.prototype.dotAll of an heir", () => {
  const heir = Object.create(RegExp.prototype);
  const value = heir.dotAll;
  console.log("RegExp.prototype.dotAll of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("RegExp.prototype.dotAll by hand", () => {
  const value = Object.getOwnPropertyDescriptor(RegExp.prototype, "dotAll").get.call({ plain: true });
  console.log("RegExp.prototype.dotAll by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("RegExp.prototype.flags of an heir", () => {
  const heir = Object.create(RegExp.prototype);
  const value = heir.flags;
  console.log("RegExp.prototype.flags of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("RegExp.prototype.flags by hand", () => {
  const value = Object.getOwnPropertyDescriptor(RegExp.prototype, "flags").get.call({ plain: true });
  console.log("RegExp.prototype.flags by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("RegExp.prototype.global of an heir", () => {
  const heir = Object.create(RegExp.prototype);
  const value = heir.global;
  console.log("RegExp.prototype.global of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("RegExp.prototype.global by hand", () => {
  const value = Object.getOwnPropertyDescriptor(RegExp.prototype, "global").get.call({ plain: true });
  console.log("RegExp.prototype.global by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("RegExp.prototype.hasIndices of an heir", () => {
  const heir = Object.create(RegExp.prototype);
  const value = heir.hasIndices;
  console.log("RegExp.prototype.hasIndices of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("RegExp.prototype.hasIndices by hand", () => {
  const value = Object.getOwnPropertyDescriptor(RegExp.prototype, "hasIndices").get.call({ plain: true });
  console.log("RegExp.prototype.hasIndices by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("RegExp.prototype.ignoreCase of an heir", () => {
  const heir = Object.create(RegExp.prototype);
  const value = heir.ignoreCase;
  console.log("RegExp.prototype.ignoreCase of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("RegExp.prototype.ignoreCase by hand", () => {
  const value = Object.getOwnPropertyDescriptor(RegExp.prototype, "ignoreCase").get.call({ plain: true });
  console.log("RegExp.prototype.ignoreCase by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("RegExp.prototype.multiline of an heir", () => {
  const heir = Object.create(RegExp.prototype);
  const value = heir.multiline;
  console.log("RegExp.prototype.multiline of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("RegExp.prototype.multiline by hand", () => {
  const value = Object.getOwnPropertyDescriptor(RegExp.prototype, "multiline").get.call({ plain: true });
  console.log("RegExp.prototype.multiline by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("RegExp.prototype.source of an heir", () => {
  const heir = Object.create(RegExp.prototype);
  const value = heir.source;
  console.log("RegExp.prototype.source of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("RegExp.prototype.source by hand", () => {
  const value = Object.getOwnPropertyDescriptor(RegExp.prototype, "source").get.call({ plain: true });
  console.log("RegExp.prototype.source by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("RegExp.prototype.sticky of an heir", () => {
  const heir = Object.create(RegExp.prototype);
  const value = heir.sticky;
  console.log("RegExp.prototype.sticky of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("RegExp.prototype.sticky by hand", () => {
  const value = Object.getOwnPropertyDescriptor(RegExp.prototype, "sticky").get.call({ plain: true });
  console.log("RegExp.prototype.sticky by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("RegExp.prototype.unicode of an heir", () => {
  const heir = Object.create(RegExp.prototype);
  const value = heir.unicode;
  console.log("RegExp.prototype.unicode of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("RegExp.prototype.unicode by hand", () => {
  const value = Object.getOwnPropertyDescriptor(RegExp.prototype, "unicode").get.call({ plain: true });
  console.log("RegExp.prototype.unicode by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("RegExp.prototype.unicodeSets of an heir", () => {
  const heir = Object.create(RegExp.prototype);
  const value = heir.unicodeSets;
  console.log("RegExp.prototype.unicodeSets of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("RegExp.prototype.unicodeSets by hand", () => {
  const value = Object.getOwnPropertyDescriptor(RegExp.prototype, "unicodeSets").get.call({ plain: true });
  console.log("RegExp.prototype.unicodeSets by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Request.prototype.body of an heir", () => {
  const heir = Object.create(Request.prototype);
  const value = heir.body;
  console.log("Request.prototype.body of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Request.prototype.body by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Request.prototype, "body").get.call({ plain: true });
  console.log("Request.prototype.body by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Request.prototype.bodyUsed of an heir", () => {
  const heir = Object.create(Request.prototype);
  const value = heir.bodyUsed;
  console.log("Request.prototype.bodyUsed of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Request.prototype.bodyUsed by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Request.prototype, "bodyUsed").get.call({ plain: true });
  console.log("Request.prototype.bodyUsed by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Request.prototype.cache of an heir", () => {
  const heir = Object.create(Request.prototype);
  const value = heir.cache;
  console.log("Request.prototype.cache of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Request.prototype.cache by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Request.prototype, "cache").get.call({ plain: true });
  console.log("Request.prototype.cache by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Request.prototype.credentials of an heir", () => {
  const heir = Object.create(Request.prototype);
  const value = heir.credentials;
  console.log("Request.prototype.credentials of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Request.prototype.credentials by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Request.prototype, "credentials").get.call({ plain: true });
  console.log("Request.prototype.credentials by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Request.prototype.destination of an heir", () => {
  const heir = Object.create(Request.prototype);
  const value = heir.destination;
  console.log("Request.prototype.destination of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Request.prototype.destination by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Request.prototype, "destination").get.call({ plain: true });
  console.log("Request.prototype.destination by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Request.prototype.headers of an heir", () => {
  const heir = Object.create(Request.prototype);
  const value = heir.headers;
  console.log("Request.prototype.headers of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Request.prototype.headers by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Request.prototype, "headers").get.call({ plain: true });
  console.log("Request.prototype.headers by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Request.prototype.integrity of an heir", () => {
  const heir = Object.create(Request.prototype);
  const value = heir.integrity;
  console.log("Request.prototype.integrity of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Request.prototype.integrity by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Request.prototype, "integrity").get.call({ plain: true });
  console.log("Request.prototype.integrity by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Request.prototype.method of an heir", () => {
  const heir = Object.create(Request.prototype);
  const value = heir.method;
  console.log("Request.prototype.method of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Request.prototype.method by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Request.prototype, "method").get.call({ plain: true });
  console.log("Request.prototype.method by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Request.prototype.mode of an heir", () => {
  const heir = Object.create(Request.prototype);
  const value = heir.mode;
  console.log("Request.prototype.mode of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Request.prototype.mode by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Request.prototype, "mode").get.call({ plain: true });
  console.log("Request.prototype.mode by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Request.prototype.redirect of an heir", () => {
  const heir = Object.create(Request.prototype);
  const value = heir.redirect;
  console.log("Request.prototype.redirect of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Request.prototype.redirect by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Request.prototype, "redirect").get.call({ plain: true });
  console.log("Request.prototype.redirect by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Request.prototype.referrer of an heir", () => {
  const heir = Object.create(Request.prototype);
  const value = heir.referrer;
  console.log("Request.prototype.referrer of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Request.prototype.referrer by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Request.prototype, "referrer").get.call({ plain: true });
  console.log("Request.prototype.referrer by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Request.prototype.referrerPolicy of an heir", () => {
  const heir = Object.create(Request.prototype);
  const value = heir.referrerPolicy;
  console.log("Request.prototype.referrerPolicy of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Request.prototype.referrerPolicy by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Request.prototype, "referrerPolicy").get.call({ plain: true });
  console.log("Request.prototype.referrerPolicy by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Request.prototype.signal of an heir", () => {
  const heir = Object.create(Request.prototype);
  const value = heir.signal;
  console.log("Request.prototype.signal of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Request.prototype.signal by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Request.prototype, "signal").get.call({ plain: true });
  console.log("Request.prototype.signal by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Request.prototype.url of an heir", () => {
  const heir = Object.create(Request.prototype);
  const value = heir.url;
  console.log("Request.prototype.url of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Request.prototype.url by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Request.prototype, "url").get.call({ plain: true });
  console.log("Request.prototype.url by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("ResolveMessage.prototype.code of an heir", () => {
  const heir = Object.create(ResolveMessage.prototype);
  const value = heir.code;
  console.log("ResolveMessage.prototype.code of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("ResolveMessage.prototype.code by hand", () => {
  const value = Object.getOwnPropertyDescriptor(ResolveMessage.prototype, "code").get.call({ plain: true });
  console.log("ResolveMessage.prototype.code by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("ResolveMessage.prototype.column of an heir", () => {
  const heir = Object.create(ResolveMessage.prototype);
  const value = heir.column;
  console.log("ResolveMessage.prototype.column of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("ResolveMessage.prototype.column by hand", () => {
  const value = Object.getOwnPropertyDescriptor(ResolveMessage.prototype, "column").get.call({ plain: true });
  console.log("ResolveMessage.prototype.column by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("ResolveMessage.prototype.importKind of an heir", () => {
  const heir = Object.create(ResolveMessage.prototype);
  const value = heir.importKind;
  console.log("ResolveMessage.prototype.importKind of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("ResolveMessage.prototype.importKind by hand", () => {
  const value = Object.getOwnPropertyDescriptor(ResolveMessage.prototype, "importKind").get.call({ plain: true });
  console.log("ResolveMessage.prototype.importKind by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("ResolveMessage.prototype.level of an heir", () => {
  const heir = Object.create(ResolveMessage.prototype);
  const value = heir.level;
  console.log("ResolveMessage.prototype.level of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("ResolveMessage.prototype.level by hand", () => {
  const value = Object.getOwnPropertyDescriptor(ResolveMessage.prototype, "level").get.call({ plain: true });
  console.log("ResolveMessage.prototype.level by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("ResolveMessage.prototype.line of an heir", () => {
  const heir = Object.create(ResolveMessage.prototype);
  const value = heir.line;
  console.log("ResolveMessage.prototype.line of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("ResolveMessage.prototype.line by hand", () => {
  const value = Object.getOwnPropertyDescriptor(ResolveMessage.prototype, "line").get.call({ plain: true });
  console.log("ResolveMessage.prototype.line by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("ResolveMessage.prototype.message of an heir", () => {
  const heir = Object.create(ResolveMessage.prototype);
  const value = heir.message;
  console.log("ResolveMessage.prototype.message of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("ResolveMessage.prototype.message by hand", () => {
  const value = Object.getOwnPropertyDescriptor(ResolveMessage.prototype, "message").get.call({ plain: true });
  console.log("ResolveMessage.prototype.message by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("ResolveMessage.prototype.message stored on an heir", () => {
  const heir = Object.create(ResolveMessage.prototype);
  heir.message = "stored";
  console.log("ResolveMessage.prototype.message stored on an heir", Object.keys(heir).join(), Object.hasOwn(heir, "message"));
});
attempt("ResolveMessage.prototype.position of an heir", () => {
  const heir = Object.create(ResolveMessage.prototype);
  const value = heir.position;
  console.log("ResolveMessage.prototype.position of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("ResolveMessage.prototype.position by hand", () => {
  const value = Object.getOwnPropertyDescriptor(ResolveMessage.prototype, "position").get.call({ plain: true });
  console.log("ResolveMessage.prototype.position by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("ResolveMessage.prototype.referrer of an heir", () => {
  const heir = Object.create(ResolveMessage.prototype);
  const value = heir.referrer;
  console.log("ResolveMessage.prototype.referrer of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("ResolveMessage.prototype.referrer by hand", () => {
  const value = Object.getOwnPropertyDescriptor(ResolveMessage.prototype, "referrer").get.call({ plain: true });
  console.log("ResolveMessage.prototype.referrer by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("ResolveMessage.prototype.requireStack of an heir", () => {
  const heir = Object.create(ResolveMessage.prototype);
  const value = heir.requireStack;
  console.log("ResolveMessage.prototype.requireStack of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("ResolveMessage.prototype.requireStack by hand", () => {
  const value = Object.getOwnPropertyDescriptor(ResolveMessage.prototype, "requireStack").get.call({ plain: true });
  console.log("ResolveMessage.prototype.requireStack by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("ResolveMessage.prototype.specifier of an heir", () => {
  const heir = Object.create(ResolveMessage.prototype);
  const value = heir.specifier;
  console.log("ResolveMessage.prototype.specifier of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("ResolveMessage.prototype.specifier by hand", () => {
  const value = Object.getOwnPropertyDescriptor(ResolveMessage.prototype, "specifier").get.call({ plain: true });
  console.log("ResolveMessage.prototype.specifier by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("ResolveMessage.prototype.stack of an heir", () => {
  const heir = Object.create(ResolveMessage.prototype);
  const value = heir.stack;
  console.log("ResolveMessage.prototype.stack of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("ResolveMessage.prototype.stack by hand", () => {
  const value = Object.getOwnPropertyDescriptor(ResolveMessage.prototype, "stack").get.call({ plain: true });
  console.log("ResolveMessage.prototype.stack by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("ResolveMessage.prototype.stack stored on an heir", () => {
  const heir = Object.create(ResolveMessage.prototype);
  heir.stack = "stored";
  console.log("ResolveMessage.prototype.stack stored on an heir", Object.keys(heir).join(), Object.hasOwn(heir, "stack"));
});
attempt("Response.prototype.body of an heir", () => {
  const heir = Object.create(Response.prototype);
  const value = heir.body;
  console.log("Response.prototype.body of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Response.prototype.body by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Response.prototype, "body").get.call({ plain: true });
  console.log("Response.prototype.body by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Response.prototype.bodyUsed of an heir", () => {
  const heir = Object.create(Response.prototype);
  const value = heir.bodyUsed;
  console.log("Response.prototype.bodyUsed of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Response.prototype.bodyUsed by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Response.prototype, "bodyUsed").get.call({ plain: true });
  console.log("Response.prototype.bodyUsed by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Response.prototype.headers of an heir", () => {
  const heir = Object.create(Response.prototype);
  const value = heir.headers;
  console.log("Response.prototype.headers of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Response.prototype.headers by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Response.prototype, "headers").get.call({ plain: true });
  console.log("Response.prototype.headers by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Response.prototype.ok of an heir", () => {
  const heir = Object.create(Response.prototype);
  const value = heir.ok;
  console.log("Response.prototype.ok of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Response.prototype.ok by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Response.prototype, "ok").get.call({ plain: true });
  console.log("Response.prototype.ok by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Response.prototype.redirected of an heir", () => {
  const heir = Object.create(Response.prototype);
  const value = heir.redirected;
  console.log("Response.prototype.redirected of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Response.prototype.redirected by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Response.prototype, "redirected").get.call({ plain: true });
  console.log("Response.prototype.redirected by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Response.prototype.status of an heir", () => {
  const heir = Object.create(Response.prototype);
  const value = heir.status;
  console.log("Response.prototype.status of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Response.prototype.status by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Response.prototype, "status").get.call({ plain: true });
  console.log("Response.prototype.status by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Response.prototype.statusText of an heir", () => {
  const heir = Object.create(Response.prototype);
  const value = heir.statusText;
  console.log("Response.prototype.statusText of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Response.prototype.statusText by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Response.prototype, "statusText").get.call({ plain: true });
  console.log("Response.prototype.statusText by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Response.prototype.type of an heir", () => {
  const heir = Object.create(Response.prototype);
  const value = heir.type;
  console.log("Response.prototype.type of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Response.prototype.type by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Response.prototype, "type").get.call({ plain: true });
  console.log("Response.prototype.type by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Response.prototype.url of an heir", () => {
  const heir = Object.create(Response.prototype);
  const value = heir.url;
  console.log("Response.prototype.url of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Response.prototype.url by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Response.prototype, "url").get.call({ plain: true });
  console.log("Response.prototype.url by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Set.prototype.size of an heir", () => {
  const heir = Object.create(Set.prototype);
  const value = heir.size;
  console.log("Set.prototype.size of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Set.prototype.size by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Set.prototype, "size").get.call({ plain: true });
  console.log("Set.prototype.size by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("SharedArrayBuffer.prototype.byteLength of an heir", () => {
  const heir = Object.create(SharedArrayBuffer.prototype);
  const value = heir.byteLength;
  console.log("SharedArrayBuffer.prototype.byteLength of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("SharedArrayBuffer.prototype.byteLength by hand", () => {
  const value = Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, "byteLength").get.call({ plain: true });
  console.log("SharedArrayBuffer.prototype.byteLength by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("SharedArrayBuffer.prototype.growable of an heir", () => {
  const heir = Object.create(SharedArrayBuffer.prototype);
  const value = heir.growable;
  console.log("SharedArrayBuffer.prototype.growable of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("SharedArrayBuffer.prototype.growable by hand", () => {
  const value = Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, "growable").get.call({ plain: true });
  console.log("SharedArrayBuffer.prototype.growable by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("SharedArrayBuffer.prototype.maxByteLength of an heir", () => {
  const heir = Object.create(SharedArrayBuffer.prototype);
  const value = heir.maxByteLength;
  console.log("SharedArrayBuffer.prototype.maxByteLength of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("SharedArrayBuffer.prototype.maxByteLength by hand", () => {
  const value = Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, "maxByteLength").get.call({ plain: true });
  console.log("SharedArrayBuffer.prototype.maxByteLength by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Symbol.prototype.description of an heir", () => {
  const heir = Object.create(Symbol.prototype);
  const value = heir.description;
  console.log("Symbol.prototype.description of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Symbol.prototype.description by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Symbol.prototype, "description").get.call({ plain: true });
  console.log("Symbol.prototype.description by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("TextDecoder.prototype.encoding of an heir", () => {
  const heir = Object.create(TextDecoder.prototype);
  const value = heir.encoding;
  console.log("TextDecoder.prototype.encoding of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("TextDecoder.prototype.encoding by hand", () => {
  const value = Object.getOwnPropertyDescriptor(TextDecoder.prototype, "encoding").get.call({ plain: true });
  console.log("TextDecoder.prototype.encoding by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("TextDecoder.prototype.fatal of an heir", () => {
  const heir = Object.create(TextDecoder.prototype);
  const value = heir.fatal;
  console.log("TextDecoder.prototype.fatal of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("TextDecoder.prototype.fatal by hand", () => {
  const value = Object.getOwnPropertyDescriptor(TextDecoder.prototype, "fatal").get.call({ plain: true });
  console.log("TextDecoder.prototype.fatal by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("TextDecoder.prototype.ignoreBOM of an heir", () => {
  const heir = Object.create(TextDecoder.prototype);
  const value = heir.ignoreBOM;
  console.log("TextDecoder.prototype.ignoreBOM of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("TextDecoder.prototype.ignoreBOM by hand", () => {
  const value = Object.getOwnPropertyDescriptor(TextDecoder.prototype, "ignoreBOM").get.call({ plain: true });
  console.log("TextDecoder.prototype.ignoreBOM by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("TextEncoder.prototype.encoding of an heir", () => {
  const heir = Object.create(TextEncoder.prototype);
  const value = heir.encoding;
  console.log("TextEncoder.prototype.encoding of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("TextEncoder.prototype.encoding by hand", () => {
  const value = Object.getOwnPropertyDescriptor(TextEncoder.prototype, "encoding").get.call({ plain: true });
  console.log("TextEncoder.prototype.encoding by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("TextEncoderStream.prototype.encoding of an heir", () => {
  const heir = Object.create(TextEncoderStream.prototype);
  const value = heir.encoding;
  console.log("TextEncoderStream.prototype.encoding of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("TextEncoderStream.prototype.encoding by hand", () => {
  const value = Object.getOwnPropertyDescriptor(TextEncoderStream.prototype, "encoding").get.call({ plain: true });
  console.log("TextEncoderStream.prototype.encoding by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("TextEncoderStream.prototype.readable of an heir", () => {
  const heir = Object.create(TextEncoderStream.prototype);
  const value = heir.readable;
  console.log("TextEncoderStream.prototype.readable of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("TextEncoderStream.prototype.readable by hand", () => {
  const value = Object.getOwnPropertyDescriptor(TextEncoderStream.prototype, "readable").get.call({ plain: true });
  console.log("TextEncoderStream.prototype.readable by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("TextEncoderStream.prototype.writable of an heir", () => {
  const heir = Object.create(TextEncoderStream.prototype);
  const value = heir.writable;
  console.log("TextEncoderStream.prototype.writable of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("TextEncoderStream.prototype.writable by hand", () => {
  const value = Object.getOwnPropertyDescriptor(TextEncoderStream.prototype, "writable").get.call({ plain: true });
  console.log("TextEncoderStream.prototype.writable by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("TransformStream.prototype.readable of an heir", () => {
  const heir = Object.create(TransformStream.prototype);
  const value = heir.readable;
  console.log("TransformStream.prototype.readable of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("TransformStream.prototype.readable by hand", () => {
  const value = Object.getOwnPropertyDescriptor(TransformStream.prototype, "readable").get.call({ plain: true });
  console.log("TransformStream.prototype.readable by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("TransformStream.prototype.writable of an heir", () => {
  const heir = Object.create(TransformStream.prototype);
  const value = heir.writable;
  console.log("TransformStream.prototype.writable of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("TransformStream.prototype.writable by hand", () => {
  const value = Object.getOwnPropertyDescriptor(TransformStream.prototype, "writable").get.call({ plain: true });
  console.log("TransformStream.prototype.writable by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("URL.prototype.hash of an heir", () => {
  const heir = Object.create(URL.prototype);
  const value = heir.hash;
  console.log("URL.prototype.hash of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("URL.prototype.hash by hand", () => {
  const value = Object.getOwnPropertyDescriptor(URL.prototype, "hash").get.call({ plain: true });
  console.log("URL.prototype.hash by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("URL.prototype.hash stored on an heir", () => {
  const heir = Object.create(URL.prototype);
  heir.hash = "stored";
  console.log("URL.prototype.hash stored on an heir", Object.keys(heir).join(), Object.hasOwn(heir, "hash"));
});
attempt("URL.prototype.host of an heir", () => {
  const heir = Object.create(URL.prototype);
  const value = heir.host;
  console.log("URL.prototype.host of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("URL.prototype.host by hand", () => {
  const value = Object.getOwnPropertyDescriptor(URL.prototype, "host").get.call({ plain: true });
  console.log("URL.prototype.host by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("URL.prototype.host stored on an heir", () => {
  const heir = Object.create(URL.prototype);
  heir.host = "stored";
  console.log("URL.prototype.host stored on an heir", Object.keys(heir).join(), Object.hasOwn(heir, "host"));
});
attempt("URL.prototype.hostname of an heir", () => {
  const heir = Object.create(URL.prototype);
  const value = heir.hostname;
  console.log("URL.prototype.hostname of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("URL.prototype.hostname by hand", () => {
  const value = Object.getOwnPropertyDescriptor(URL.prototype, "hostname").get.call({ plain: true });
  console.log("URL.prototype.hostname by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("URL.prototype.hostname stored on an heir", () => {
  const heir = Object.create(URL.prototype);
  heir.hostname = "stored";
  console.log("URL.prototype.hostname stored on an heir", Object.keys(heir).join(), Object.hasOwn(heir, "hostname"));
});
attempt("URL.prototype.href of an heir", () => {
  const heir = Object.create(URL.prototype);
  const value = heir.href;
  console.log("URL.prototype.href of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("URL.prototype.href by hand", () => {
  const value = Object.getOwnPropertyDescriptor(URL.prototype, "href").get.call({ plain: true });
  console.log("URL.prototype.href by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("URL.prototype.href stored on an heir", () => {
  const heir = Object.create(URL.prototype);
  heir.href = "stored";
  console.log("URL.prototype.href stored on an heir", Object.keys(heir).join(), Object.hasOwn(heir, "href"));
});
attempt("URL.prototype.origin of an heir", () => {
  const heir = Object.create(URL.prototype);
  const value = heir.origin;
  console.log("URL.prototype.origin of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("URL.prototype.origin by hand", () => {
  const value = Object.getOwnPropertyDescriptor(URL.prototype, "origin").get.call({ plain: true });
  console.log("URL.prototype.origin by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("URL.prototype.password of an heir", () => {
  const heir = Object.create(URL.prototype);
  const value = heir.password;
  console.log("URL.prototype.password of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("URL.prototype.password by hand", () => {
  const value = Object.getOwnPropertyDescriptor(URL.prototype, "password").get.call({ plain: true });
  console.log("URL.prototype.password by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("URL.prototype.password stored on an heir", () => {
  const heir = Object.create(URL.prototype);
  heir.password = "stored";
  console.log("URL.prototype.password stored on an heir", Object.keys(heir).join(), Object.hasOwn(heir, "password"));
});
attempt("URL.prototype.pathname of an heir", () => {
  const heir = Object.create(URL.prototype);
  const value = heir.pathname;
  console.log("URL.prototype.pathname of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("URL.prototype.pathname by hand", () => {
  const value = Object.getOwnPropertyDescriptor(URL.prototype, "pathname").get.call({ plain: true });
  console.log("URL.prototype.pathname by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("URL.prototype.pathname stored on an heir", () => {
  const heir = Object.create(URL.prototype);
  heir.pathname = "stored";
  console.log("URL.prototype.pathname stored on an heir", Object.keys(heir).join(), Object.hasOwn(heir, "pathname"));
});
attempt("URL.prototype.port of an heir", () => {
  const heir = Object.create(URL.prototype);
  const value = heir.port;
  console.log("URL.prototype.port of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("URL.prototype.port by hand", () => {
  const value = Object.getOwnPropertyDescriptor(URL.prototype, "port").get.call({ plain: true });
  console.log("URL.prototype.port by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("URL.prototype.port stored on an heir", () => {
  const heir = Object.create(URL.prototype);
  heir.port = "stored";
  console.log("URL.prototype.port stored on an heir", Object.keys(heir).join(), Object.hasOwn(heir, "port"));
});
attempt("URL.prototype.protocol of an heir", () => {
  const heir = Object.create(URL.prototype);
  const value = heir.protocol;
  console.log("URL.prototype.protocol of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("URL.prototype.protocol by hand", () => {
  const value = Object.getOwnPropertyDescriptor(URL.prototype, "protocol").get.call({ plain: true });
  console.log("URL.prototype.protocol by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("URL.prototype.protocol stored on an heir", () => {
  const heir = Object.create(URL.prototype);
  heir.protocol = "stored";
  console.log("URL.prototype.protocol stored on an heir", Object.keys(heir).join(), Object.hasOwn(heir, "protocol"));
});
attempt("URL.prototype.search of an heir", () => {
  const heir = Object.create(URL.prototype);
  const value = heir.search;
  console.log("URL.prototype.search of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("URL.prototype.search by hand", () => {
  const value = Object.getOwnPropertyDescriptor(URL.prototype, "search").get.call({ plain: true });
  console.log("URL.prototype.search by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("URL.prototype.search stored on an heir", () => {
  const heir = Object.create(URL.prototype);
  heir.search = "stored";
  console.log("URL.prototype.search stored on an heir", Object.keys(heir).join(), Object.hasOwn(heir, "search"));
});
attempt("URL.prototype.searchParams of an heir", () => {
  const heir = Object.create(URL.prototype);
  const value = heir.searchParams;
  console.log("URL.prototype.searchParams of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("URL.prototype.searchParams by hand", () => {
  const value = Object.getOwnPropertyDescriptor(URL.prototype, "searchParams").get.call({ plain: true });
  console.log("URL.prototype.searchParams by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("URL.prototype.username of an heir", () => {
  const heir = Object.create(URL.prototype);
  const value = heir.username;
  console.log("URL.prototype.username of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("URL.prototype.username by hand", () => {
  const value = Object.getOwnPropertyDescriptor(URL.prototype, "username").get.call({ plain: true });
  console.log("URL.prototype.username by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("URL.prototype.username stored on an heir", () => {
  const heir = Object.create(URL.prototype);
  heir.username = "stored";
  console.log("URL.prototype.username stored on an heir", Object.keys(heir).join(), Object.hasOwn(heir, "username"));
});
attempt("URLSearchParams.prototype.length of an heir", () => {
  const heir = Object.create(URLSearchParams.prototype);
  const value = heir.length;
  console.log("URLSearchParams.prototype.length of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("URLSearchParams.prototype.length by hand", () => {
  const value = Object.getOwnPropertyDescriptor(URLSearchParams.prototype, "length").get.call({ plain: true });
  console.log("URLSearchParams.prototype.length by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("URLSearchParams.prototype.size of an heir", () => {
  const heir = Object.create(URLSearchParams.prototype);
  const value = heir.size;
  console.log("URLSearchParams.prototype.size of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("URLSearchParams.prototype.size by hand", () => {
  const value = Object.getOwnPropertyDescriptor(URLSearchParams.prototype, "size").get.call({ plain: true });
  console.log("URLSearchParams.prototype.size by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("WritableStream.prototype.locked of an heir", () => {
  const heir = Object.create(WritableStream.prototype);
  const value = heir.locked;
  console.log("WritableStream.prototype.locked of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("WritableStream.prototype.locked by hand", () => {
  const value = Object.getOwnPropertyDescriptor(WritableStream.prototype, "locked").get.call({ plain: true });
  console.log("WritableStream.prototype.locked by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Bun.CryptoHasher.prototype.algorithm of an heir", () => {
  const heir = Object.create(Bun.CryptoHasher.prototype);
  const value = heir.algorithm;
  console.log("Bun.CryptoHasher.prototype.algorithm of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Bun.CryptoHasher.prototype.algorithm by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Bun.CryptoHasher.prototype, "algorithm").get.call({ plain: true });
  console.log("Bun.CryptoHasher.prototype.algorithm by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Bun.CryptoHasher.prototype.byteLength of an heir", () => {
  const heir = Object.create(Bun.CryptoHasher.prototype);
  const value = heir.byteLength;
  console.log("Bun.CryptoHasher.prototype.byteLength of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Bun.CryptoHasher.prototype.byteLength by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Bun.CryptoHasher.prototype, "byteLength").get.call({ plain: true });
  console.log("Bun.CryptoHasher.prototype.byteLength by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Bun.FetchSession.prototype.fetch of an heir", () => {
  const heir = Object.create(Bun.FetchSession.prototype);
  const value = heir.fetch;
  console.log("Bun.FetchSession.prototype.fetch of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Bun.FetchSession.prototype.fetch by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Bun.FetchSession.prototype, "fetch").get.call({ plain: true });
  console.log("Bun.FetchSession.prototype.fetch by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Bun.FileSystemRouter.prototype.origin of an heir", () => {
  const heir = Object.create(Bun.FileSystemRouter.prototype);
  const value = heir.origin;
  console.log("Bun.FileSystemRouter.prototype.origin of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Bun.FileSystemRouter.prototype.origin by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Bun.FileSystemRouter.prototype, "origin").get.call({ plain: true });
  console.log("Bun.FileSystemRouter.prototype.origin by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Bun.FileSystemRouter.prototype.routes of an heir", () => {
  const heir = Object.create(Bun.FileSystemRouter.prototype);
  const value = heir.routes;
  console.log("Bun.FileSystemRouter.prototype.routes of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Bun.FileSystemRouter.prototype.routes by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Bun.FileSystemRouter.prototype, "routes").get.call({ plain: true });
  console.log("Bun.FileSystemRouter.prototype.routes by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Bun.FileSystemRouter.prototype.style of an heir", () => {
  const heir = Object.create(Bun.FileSystemRouter.prototype);
  const value = heir.style;
  console.log("Bun.FileSystemRouter.prototype.style of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Bun.FileSystemRouter.prototype.style by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Bun.FileSystemRouter.prototype, "style").get.call({ plain: true });
  console.log("Bun.FileSystemRouter.prototype.style by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Bun.Image.prototype.height of an heir", () => {
  const heir = Object.create(Bun.Image.prototype);
  const value = heir.height;
  console.log("Bun.Image.prototype.height of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Bun.Image.prototype.height by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Bun.Image.prototype, "height").get.call({ plain: true });
  console.log("Bun.Image.prototype.height by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Bun.Image.prototype.width of an heir", () => {
  const heir = Object.create(Bun.Image.prototype);
  const value = heir.width;
  console.log("Bun.Image.prototype.width of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Bun.Image.prototype.width by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Bun.Image.prototype, "width").get.call({ plain: true });
  console.log("Bun.Image.prototype.width by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Bun.MD4.prototype.byteLength of an heir", () => {
  const heir = Object.create(Bun.MD4.prototype);
  const value = heir.byteLength;
  console.log("Bun.MD4.prototype.byteLength of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Bun.MD4.prototype.byteLength by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Bun.MD4.prototype, "byteLength").get.call({ plain: true });
  console.log("Bun.MD4.prototype.byteLength by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Bun.MD5.prototype.byteLength of an heir", () => {
  const heir = Object.create(Bun.MD5.prototype);
  const value = heir.byteLength;
  console.log("Bun.MD5.prototype.byteLength of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Bun.MD5.prototype.byteLength by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Bun.MD5.prototype, "byteLength").get.call({ plain: true });
  console.log("Bun.MD5.prototype.byteLength by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Bun.RedisClient.prototype.bufferedAmount of an heir", () => {
  const heir = Object.create(Bun.RedisClient.prototype);
  const value = heir.bufferedAmount;
  console.log("Bun.RedisClient.prototype.bufferedAmount of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Bun.RedisClient.prototype.bufferedAmount by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Bun.RedisClient.prototype, "bufferedAmount").get.call({ plain: true });
  console.log("Bun.RedisClient.prototype.bufferedAmount by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Bun.RedisClient.prototype.connected of an heir", () => {
  const heir = Object.create(Bun.RedisClient.prototype);
  const value = heir.connected;
  console.log("Bun.RedisClient.prototype.connected of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Bun.RedisClient.prototype.connected by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Bun.RedisClient.prototype, "connected").get.call({ plain: true });
  console.log("Bun.RedisClient.prototype.connected by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Bun.RedisClient.prototype.onclose of an heir", () => {
  const heir = Object.create(Bun.RedisClient.prototype);
  const value = heir.onclose;
  console.log("Bun.RedisClient.prototype.onclose of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Bun.RedisClient.prototype.onclose by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Bun.RedisClient.prototype, "onclose").get.call({ plain: true });
  console.log("Bun.RedisClient.prototype.onclose by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Bun.RedisClient.prototype.onclose stored on an heir", () => {
  const heir = Object.create(Bun.RedisClient.prototype);
  heir.onclose = "stored";
  console.log("Bun.RedisClient.prototype.onclose stored on an heir", Object.keys(heir).join(), Object.hasOwn(heir, "onclose"));
});
attempt("Bun.RedisClient.prototype.onconnect of an heir", () => {
  const heir = Object.create(Bun.RedisClient.prototype);
  const value = heir.onconnect;
  console.log("Bun.RedisClient.prototype.onconnect of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Bun.RedisClient.prototype.onconnect by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Bun.RedisClient.prototype, "onconnect").get.call({ plain: true });
  console.log("Bun.RedisClient.prototype.onconnect by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Bun.RedisClient.prototype.onconnect stored on an heir", () => {
  const heir = Object.create(Bun.RedisClient.prototype);
  heir.onconnect = "stored";
  console.log("Bun.RedisClient.prototype.onconnect stored on an heir", Object.keys(heir).join(), Object.hasOwn(heir, "onconnect"));
});
attempt("Bun.SHA1.prototype.byteLength of an heir", () => {
  const heir = Object.create(Bun.SHA1.prototype);
  const value = heir.byteLength;
  console.log("Bun.SHA1.prototype.byteLength of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Bun.SHA1.prototype.byteLength by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Bun.SHA1.prototype, "byteLength").get.call({ plain: true });
  console.log("Bun.SHA1.prototype.byteLength by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Bun.SHA224.prototype.byteLength of an heir", () => {
  const heir = Object.create(Bun.SHA224.prototype);
  const value = heir.byteLength;
  console.log("Bun.SHA224.prototype.byteLength of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Bun.SHA224.prototype.byteLength by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Bun.SHA224.prototype, "byteLength").get.call({ plain: true });
  console.log("Bun.SHA224.prototype.byteLength by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Bun.SHA256.prototype.byteLength of an heir", () => {
  const heir = Object.create(Bun.SHA256.prototype);
  const value = heir.byteLength;
  console.log("Bun.SHA256.prototype.byteLength of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Bun.SHA256.prototype.byteLength by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Bun.SHA256.prototype, "byteLength").get.call({ plain: true });
  console.log("Bun.SHA256.prototype.byteLength by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Bun.SHA384.prototype.byteLength of an heir", () => {
  const heir = Object.create(Bun.SHA384.prototype);
  const value = heir.byteLength;
  console.log("Bun.SHA384.prototype.byteLength of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Bun.SHA384.prototype.byteLength by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Bun.SHA384.prototype, "byteLength").get.call({ plain: true });
  console.log("Bun.SHA384.prototype.byteLength by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Bun.SHA512.prototype.byteLength of an heir", () => {
  const heir = Object.create(Bun.SHA512.prototype);
  const value = heir.byteLength;
  console.log("Bun.SHA512.prototype.byteLength of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Bun.SHA512.prototype.byteLength by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Bun.SHA512.prototype, "byteLength").get.call({ plain: true });
  console.log("Bun.SHA512.prototype.byteLength by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Bun.SHA512_256.prototype.byteLength of an heir", () => {
  const heir = Object.create(Bun.SHA512_256.prototype);
  const value = heir.byteLength;
  console.log("Bun.SHA512_256.prototype.byteLength of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Bun.SHA512_256.prototype.byteLength by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Bun.SHA512_256.prototype, "byteLength").get.call({ plain: true });
  console.log("Bun.SHA512_256.prototype.byteLength by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Bun.Terminal.prototype.closed of an heir", () => {
  const heir = Object.create(Bun.Terminal.prototype);
  const value = heir.closed;
  console.log("Bun.Terminal.prototype.closed of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Bun.Terminal.prototype.closed by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Bun.Terminal.prototype, "closed").get.call({ plain: true });
  console.log("Bun.Terminal.prototype.closed by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Bun.Terminal.prototype.controlFlags of an heir", () => {
  const heir = Object.create(Bun.Terminal.prototype);
  const value = heir.controlFlags;
  console.log("Bun.Terminal.prototype.controlFlags of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Bun.Terminal.prototype.controlFlags by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Bun.Terminal.prototype, "controlFlags").get.call({ plain: true });
  console.log("Bun.Terminal.prototype.controlFlags by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Bun.Terminal.prototype.controlFlags stored on an heir", () => {
  const heir = Object.create(Bun.Terminal.prototype);
  heir.controlFlags = "stored";
  console.log("Bun.Terminal.prototype.controlFlags stored on an heir", Object.keys(heir).join(), Object.hasOwn(heir, "controlFlags"));
});
attempt("Bun.Terminal.prototype.inputFlags of an heir", () => {
  const heir = Object.create(Bun.Terminal.prototype);
  const value = heir.inputFlags;
  console.log("Bun.Terminal.prototype.inputFlags of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Bun.Terminal.prototype.inputFlags by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Bun.Terminal.prototype, "inputFlags").get.call({ plain: true });
  console.log("Bun.Terminal.prototype.inputFlags by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Bun.Terminal.prototype.inputFlags stored on an heir", () => {
  const heir = Object.create(Bun.Terminal.prototype);
  heir.inputFlags = "stored";
  console.log("Bun.Terminal.prototype.inputFlags stored on an heir", Object.keys(heir).join(), Object.hasOwn(heir, "inputFlags"));
});
attempt("Bun.Terminal.prototype.localFlags of an heir", () => {
  const heir = Object.create(Bun.Terminal.prototype);
  const value = heir.localFlags;
  console.log("Bun.Terminal.prototype.localFlags of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Bun.Terminal.prototype.localFlags by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Bun.Terminal.prototype, "localFlags").get.call({ plain: true });
  console.log("Bun.Terminal.prototype.localFlags by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Bun.Terminal.prototype.localFlags stored on an heir", () => {
  const heir = Object.create(Bun.Terminal.prototype);
  heir.localFlags = "stored";
  console.log("Bun.Terminal.prototype.localFlags stored on an heir", Object.keys(heir).join(), Object.hasOwn(heir, "localFlags"));
});
attempt("Bun.Terminal.prototype.outputFlags of an heir", () => {
  const heir = Object.create(Bun.Terminal.prototype);
  const value = heir.outputFlags;
  console.log("Bun.Terminal.prototype.outputFlags of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Bun.Terminal.prototype.outputFlags by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Bun.Terminal.prototype, "outputFlags").get.call({ plain: true });
  console.log("Bun.Terminal.prototype.outputFlags by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Bun.Terminal.prototype.outputFlags stored on an heir", () => {
  const heir = Object.create(Bun.Terminal.prototype);
  heir.outputFlags = "stored";
  console.log("Bun.Terminal.prototype.outputFlags stored on an heir", Object.keys(heir).join(), Object.hasOwn(heir, "outputFlags"));
});
attempt("Intl.Collator.prototype.compare of an heir", () => {
  const heir = Object.create(Intl.Collator.prototype);
  const value = heir.compare;
  console.log("Intl.Collator.prototype.compare of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Intl.Collator.prototype.compare by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Intl.Collator.prototype, "compare").get.call({ plain: true });
  console.log("Intl.Collator.prototype.compare by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Intl.DateTimeFormat.prototype.format of an heir", () => {
  const heir = Object.create(Intl.DateTimeFormat.prototype);
  const value = heir.format;
  console.log("Intl.DateTimeFormat.prototype.format of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Intl.DateTimeFormat.prototype.format by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, "format").get.call({ plain: true });
  console.log("Intl.DateTimeFormat.prototype.format by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Intl.Locale.prototype.baseName of an heir", () => {
  const heir = Object.create(Intl.Locale.prototype);
  const value = heir.baseName;
  console.log("Intl.Locale.prototype.baseName of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Intl.Locale.prototype.baseName by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Intl.Locale.prototype, "baseName").get.call({ plain: true });
  console.log("Intl.Locale.prototype.baseName by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Intl.Locale.prototype.calendar of an heir", () => {
  const heir = Object.create(Intl.Locale.prototype);
  const value = heir.calendar;
  console.log("Intl.Locale.prototype.calendar of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Intl.Locale.prototype.calendar by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Intl.Locale.prototype, "calendar").get.call({ plain: true });
  console.log("Intl.Locale.prototype.calendar by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Intl.Locale.prototype.caseFirst of an heir", () => {
  const heir = Object.create(Intl.Locale.prototype);
  const value = heir.caseFirst;
  console.log("Intl.Locale.prototype.caseFirst of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Intl.Locale.prototype.caseFirst by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Intl.Locale.prototype, "caseFirst").get.call({ plain: true });
  console.log("Intl.Locale.prototype.caseFirst by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Intl.Locale.prototype.collation of an heir", () => {
  const heir = Object.create(Intl.Locale.prototype);
  const value = heir.collation;
  console.log("Intl.Locale.prototype.collation of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Intl.Locale.prototype.collation by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Intl.Locale.prototype, "collation").get.call({ plain: true });
  console.log("Intl.Locale.prototype.collation by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Intl.Locale.prototype.firstDayOfWeek of an heir", () => {
  const heir = Object.create(Intl.Locale.prototype);
  const value = heir.firstDayOfWeek;
  console.log("Intl.Locale.prototype.firstDayOfWeek of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Intl.Locale.prototype.firstDayOfWeek by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Intl.Locale.prototype, "firstDayOfWeek").get.call({ plain: true });
  console.log("Intl.Locale.prototype.firstDayOfWeek by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Intl.Locale.prototype.hourCycle of an heir", () => {
  const heir = Object.create(Intl.Locale.prototype);
  const value = heir.hourCycle;
  console.log("Intl.Locale.prototype.hourCycle of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Intl.Locale.prototype.hourCycle by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Intl.Locale.prototype, "hourCycle").get.call({ plain: true });
  console.log("Intl.Locale.prototype.hourCycle by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Intl.Locale.prototype.language of an heir", () => {
  const heir = Object.create(Intl.Locale.prototype);
  const value = heir.language;
  console.log("Intl.Locale.prototype.language of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Intl.Locale.prototype.language by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Intl.Locale.prototype, "language").get.call({ plain: true });
  console.log("Intl.Locale.prototype.language by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Intl.Locale.prototype.numberingSystem of an heir", () => {
  const heir = Object.create(Intl.Locale.prototype);
  const value = heir.numberingSystem;
  console.log("Intl.Locale.prototype.numberingSystem of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Intl.Locale.prototype.numberingSystem by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Intl.Locale.prototype, "numberingSystem").get.call({ plain: true });
  console.log("Intl.Locale.prototype.numberingSystem by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Intl.Locale.prototype.numeric of an heir", () => {
  const heir = Object.create(Intl.Locale.prototype);
  const value = heir.numeric;
  console.log("Intl.Locale.prototype.numeric of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Intl.Locale.prototype.numeric by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Intl.Locale.prototype, "numeric").get.call({ plain: true });
  console.log("Intl.Locale.prototype.numeric by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Intl.Locale.prototype.region of an heir", () => {
  const heir = Object.create(Intl.Locale.prototype);
  const value = heir.region;
  console.log("Intl.Locale.prototype.region of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Intl.Locale.prototype.region by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Intl.Locale.prototype, "region").get.call({ plain: true });
  console.log("Intl.Locale.prototype.region by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Intl.Locale.prototype.script of an heir", () => {
  const heir = Object.create(Intl.Locale.prototype);
  const value = heir.script;
  console.log("Intl.Locale.prototype.script of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Intl.Locale.prototype.script by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Intl.Locale.prototype, "script").get.call({ plain: true });
  console.log("Intl.Locale.prototype.script by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Intl.Locale.prototype.variants of an heir", () => {
  const heir = Object.create(Intl.Locale.prototype);
  const value = heir.variants;
  console.log("Intl.Locale.prototype.variants of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Intl.Locale.prototype.variants by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Intl.Locale.prototype, "variants").get.call({ plain: true });
  console.log("Intl.Locale.prototype.variants by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Intl.NumberFormat.prototype.format of an heir", () => {
  const heir = Object.create(Intl.NumberFormat.prototype);
  const value = heir.format;
  console.log("Intl.NumberFormat.prototype.format of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Intl.NumberFormat.prototype.format by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Intl.NumberFormat.prototype, "format").get.call({ plain: true });
  console.log("Intl.NumberFormat.prototype.format by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.Duration.prototype.blank of an heir", () => {
  const heir = Object.create(Temporal.Duration.prototype);
  const value = heir.blank;
  console.log("Temporal.Duration.prototype.blank of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.Duration.prototype.blank by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.Duration.prototype, "blank").get.call({ plain: true });
  console.log("Temporal.Duration.prototype.blank by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.Duration.prototype.days of an heir", () => {
  const heir = Object.create(Temporal.Duration.prototype);
  const value = heir.days;
  console.log("Temporal.Duration.prototype.days of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.Duration.prototype.days by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.Duration.prototype, "days").get.call({ plain: true });
  console.log("Temporal.Duration.prototype.days by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.Duration.prototype.hours of an heir", () => {
  const heir = Object.create(Temporal.Duration.prototype);
  const value = heir.hours;
  console.log("Temporal.Duration.prototype.hours of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.Duration.prototype.hours by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.Duration.prototype, "hours").get.call({ plain: true });
  console.log("Temporal.Duration.prototype.hours by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.Duration.prototype.microseconds of an heir", () => {
  const heir = Object.create(Temporal.Duration.prototype);
  const value = heir.microseconds;
  console.log("Temporal.Duration.prototype.microseconds of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.Duration.prototype.microseconds by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.Duration.prototype, "microseconds").get.call({ plain: true });
  console.log("Temporal.Duration.prototype.microseconds by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.Duration.prototype.milliseconds of an heir", () => {
  const heir = Object.create(Temporal.Duration.prototype);
  const value = heir.milliseconds;
  console.log("Temporal.Duration.prototype.milliseconds of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.Duration.prototype.milliseconds by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.Duration.prototype, "milliseconds").get.call({ plain: true });
  console.log("Temporal.Duration.prototype.milliseconds by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.Duration.prototype.minutes of an heir", () => {
  const heir = Object.create(Temporal.Duration.prototype);
  const value = heir.minutes;
  console.log("Temporal.Duration.prototype.minutes of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.Duration.prototype.minutes by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.Duration.prototype, "minutes").get.call({ plain: true });
  console.log("Temporal.Duration.prototype.minutes by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.Duration.prototype.months of an heir", () => {
  const heir = Object.create(Temporal.Duration.prototype);
  const value = heir.months;
  console.log("Temporal.Duration.prototype.months of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.Duration.prototype.months by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.Duration.prototype, "months").get.call({ plain: true });
  console.log("Temporal.Duration.prototype.months by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.Duration.prototype.nanoseconds of an heir", () => {
  const heir = Object.create(Temporal.Duration.prototype);
  const value = heir.nanoseconds;
  console.log("Temporal.Duration.prototype.nanoseconds of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.Duration.prototype.nanoseconds by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.Duration.prototype, "nanoseconds").get.call({ plain: true });
  console.log("Temporal.Duration.prototype.nanoseconds by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.Duration.prototype.seconds of an heir", () => {
  const heir = Object.create(Temporal.Duration.prototype);
  const value = heir.seconds;
  console.log("Temporal.Duration.prototype.seconds of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.Duration.prototype.seconds by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.Duration.prototype, "seconds").get.call({ plain: true });
  console.log("Temporal.Duration.prototype.seconds by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.Duration.prototype.sign of an heir", () => {
  const heir = Object.create(Temporal.Duration.prototype);
  const value = heir.sign;
  console.log("Temporal.Duration.prototype.sign of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.Duration.prototype.sign by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.Duration.prototype, "sign").get.call({ plain: true });
  console.log("Temporal.Duration.prototype.sign by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.Duration.prototype.weeks of an heir", () => {
  const heir = Object.create(Temporal.Duration.prototype);
  const value = heir.weeks;
  console.log("Temporal.Duration.prototype.weeks of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.Duration.prototype.weeks by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.Duration.prototype, "weeks").get.call({ plain: true });
  console.log("Temporal.Duration.prototype.weeks by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.Duration.prototype.years of an heir", () => {
  const heir = Object.create(Temporal.Duration.prototype);
  const value = heir.years;
  console.log("Temporal.Duration.prototype.years of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.Duration.prototype.years by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.Duration.prototype, "years").get.call({ plain: true });
  console.log("Temporal.Duration.prototype.years by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.Instant.prototype.epochMilliseconds of an heir", () => {
  const heir = Object.create(Temporal.Instant.prototype);
  const value = heir.epochMilliseconds;
  console.log("Temporal.Instant.prototype.epochMilliseconds of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.Instant.prototype.epochMilliseconds by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.Instant.prototype, "epochMilliseconds").get.call({ plain: true });
  console.log("Temporal.Instant.prototype.epochMilliseconds by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.Instant.prototype.epochNanoseconds of an heir", () => {
  const heir = Object.create(Temporal.Instant.prototype);
  const value = heir.epochNanoseconds;
  console.log("Temporal.Instant.prototype.epochNanoseconds of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.Instant.prototype.epochNanoseconds by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.Instant.prototype, "epochNanoseconds").get.call({ plain: true });
  console.log("Temporal.Instant.prototype.epochNanoseconds by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDate.prototype.calendarId of an heir", () => {
  const heir = Object.create(Temporal.PlainDate.prototype);
  const value = heir.calendarId;
  console.log("Temporal.PlainDate.prototype.calendarId of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDate.prototype.calendarId by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDate.prototype, "calendarId").get.call({ plain: true });
  console.log("Temporal.PlainDate.prototype.calendarId by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDate.prototype.day of an heir", () => {
  const heir = Object.create(Temporal.PlainDate.prototype);
  const value = heir.day;
  console.log("Temporal.PlainDate.prototype.day of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDate.prototype.day by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDate.prototype, "day").get.call({ plain: true });
  console.log("Temporal.PlainDate.prototype.day by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDate.prototype.dayOfWeek of an heir", () => {
  const heir = Object.create(Temporal.PlainDate.prototype);
  const value = heir.dayOfWeek;
  console.log("Temporal.PlainDate.prototype.dayOfWeek of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDate.prototype.dayOfWeek by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDate.prototype, "dayOfWeek").get.call({ plain: true });
  console.log("Temporal.PlainDate.prototype.dayOfWeek by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDate.prototype.dayOfYear of an heir", () => {
  const heir = Object.create(Temporal.PlainDate.prototype);
  const value = heir.dayOfYear;
  console.log("Temporal.PlainDate.prototype.dayOfYear of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDate.prototype.dayOfYear by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDate.prototype, "dayOfYear").get.call({ plain: true });
  console.log("Temporal.PlainDate.prototype.dayOfYear by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDate.prototype.daysInMonth of an heir", () => {
  const heir = Object.create(Temporal.PlainDate.prototype);
  const value = heir.daysInMonth;
  console.log("Temporal.PlainDate.prototype.daysInMonth of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDate.prototype.daysInMonth by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDate.prototype, "daysInMonth").get.call({ plain: true });
  console.log("Temporal.PlainDate.prototype.daysInMonth by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDate.prototype.daysInWeek of an heir", () => {
  const heir = Object.create(Temporal.PlainDate.prototype);
  const value = heir.daysInWeek;
  console.log("Temporal.PlainDate.prototype.daysInWeek of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDate.prototype.daysInWeek by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDate.prototype, "daysInWeek").get.call({ plain: true });
  console.log("Temporal.PlainDate.prototype.daysInWeek by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDate.prototype.daysInYear of an heir", () => {
  const heir = Object.create(Temporal.PlainDate.prototype);
  const value = heir.daysInYear;
  console.log("Temporal.PlainDate.prototype.daysInYear of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDate.prototype.daysInYear by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDate.prototype, "daysInYear").get.call({ plain: true });
  console.log("Temporal.PlainDate.prototype.daysInYear by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDate.prototype.era of an heir", () => {
  const heir = Object.create(Temporal.PlainDate.prototype);
  const value = heir.era;
  console.log("Temporal.PlainDate.prototype.era of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDate.prototype.era by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDate.prototype, "era").get.call({ plain: true });
  console.log("Temporal.PlainDate.prototype.era by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDate.prototype.eraYear of an heir", () => {
  const heir = Object.create(Temporal.PlainDate.prototype);
  const value = heir.eraYear;
  console.log("Temporal.PlainDate.prototype.eraYear of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDate.prototype.eraYear by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDate.prototype, "eraYear").get.call({ plain: true });
  console.log("Temporal.PlainDate.prototype.eraYear by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDate.prototype.inLeapYear of an heir", () => {
  const heir = Object.create(Temporal.PlainDate.prototype);
  const value = heir.inLeapYear;
  console.log("Temporal.PlainDate.prototype.inLeapYear of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDate.prototype.inLeapYear by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDate.prototype, "inLeapYear").get.call({ plain: true });
  console.log("Temporal.PlainDate.prototype.inLeapYear by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDate.prototype.month of an heir", () => {
  const heir = Object.create(Temporal.PlainDate.prototype);
  const value = heir.month;
  console.log("Temporal.PlainDate.prototype.month of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDate.prototype.month by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDate.prototype, "month").get.call({ plain: true });
  console.log("Temporal.PlainDate.prototype.month by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDate.prototype.monthCode of an heir", () => {
  const heir = Object.create(Temporal.PlainDate.prototype);
  const value = heir.monthCode;
  console.log("Temporal.PlainDate.prototype.monthCode of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDate.prototype.monthCode by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDate.prototype, "monthCode").get.call({ plain: true });
  console.log("Temporal.PlainDate.prototype.monthCode by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDate.prototype.monthsInYear of an heir", () => {
  const heir = Object.create(Temporal.PlainDate.prototype);
  const value = heir.monthsInYear;
  console.log("Temporal.PlainDate.prototype.monthsInYear of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDate.prototype.monthsInYear by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDate.prototype, "monthsInYear").get.call({ plain: true });
  console.log("Temporal.PlainDate.prototype.monthsInYear by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDate.prototype.weekOfYear of an heir", () => {
  const heir = Object.create(Temporal.PlainDate.prototype);
  const value = heir.weekOfYear;
  console.log("Temporal.PlainDate.prototype.weekOfYear of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDate.prototype.weekOfYear by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDate.prototype, "weekOfYear").get.call({ plain: true });
  console.log("Temporal.PlainDate.prototype.weekOfYear by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDate.prototype.year of an heir", () => {
  const heir = Object.create(Temporal.PlainDate.prototype);
  const value = heir.year;
  console.log("Temporal.PlainDate.prototype.year of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDate.prototype.year by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDate.prototype, "year").get.call({ plain: true });
  console.log("Temporal.PlainDate.prototype.year by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDate.prototype.yearOfWeek of an heir", () => {
  const heir = Object.create(Temporal.PlainDate.prototype);
  const value = heir.yearOfWeek;
  console.log("Temporal.PlainDate.prototype.yearOfWeek of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDate.prototype.yearOfWeek by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDate.prototype, "yearOfWeek").get.call({ plain: true });
  console.log("Temporal.PlainDate.prototype.yearOfWeek by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDateTime.prototype.calendarId of an heir", () => {
  const heir = Object.create(Temporal.PlainDateTime.prototype);
  const value = heir.calendarId;
  console.log("Temporal.PlainDateTime.prototype.calendarId of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDateTime.prototype.calendarId by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDateTime.prototype, "calendarId").get.call({ plain: true });
  console.log("Temporal.PlainDateTime.prototype.calendarId by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDateTime.prototype.day of an heir", () => {
  const heir = Object.create(Temporal.PlainDateTime.prototype);
  const value = heir.day;
  console.log("Temporal.PlainDateTime.prototype.day of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDateTime.prototype.day by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDateTime.prototype, "day").get.call({ plain: true });
  console.log("Temporal.PlainDateTime.prototype.day by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDateTime.prototype.dayOfWeek of an heir", () => {
  const heir = Object.create(Temporal.PlainDateTime.prototype);
  const value = heir.dayOfWeek;
  console.log("Temporal.PlainDateTime.prototype.dayOfWeek of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDateTime.prototype.dayOfWeek by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDateTime.prototype, "dayOfWeek").get.call({ plain: true });
  console.log("Temporal.PlainDateTime.prototype.dayOfWeek by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDateTime.prototype.dayOfYear of an heir", () => {
  const heir = Object.create(Temporal.PlainDateTime.prototype);
  const value = heir.dayOfYear;
  console.log("Temporal.PlainDateTime.prototype.dayOfYear of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDateTime.prototype.dayOfYear by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDateTime.prototype, "dayOfYear").get.call({ plain: true });
  console.log("Temporal.PlainDateTime.prototype.dayOfYear by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDateTime.prototype.daysInMonth of an heir", () => {
  const heir = Object.create(Temporal.PlainDateTime.prototype);
  const value = heir.daysInMonth;
  console.log("Temporal.PlainDateTime.prototype.daysInMonth of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDateTime.prototype.daysInMonth by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDateTime.prototype, "daysInMonth").get.call({ plain: true });
  console.log("Temporal.PlainDateTime.prototype.daysInMonth by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDateTime.prototype.daysInWeek of an heir", () => {
  const heir = Object.create(Temporal.PlainDateTime.prototype);
  const value = heir.daysInWeek;
  console.log("Temporal.PlainDateTime.prototype.daysInWeek of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDateTime.prototype.daysInWeek by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDateTime.prototype, "daysInWeek").get.call({ plain: true });
  console.log("Temporal.PlainDateTime.prototype.daysInWeek by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDateTime.prototype.daysInYear of an heir", () => {
  const heir = Object.create(Temporal.PlainDateTime.prototype);
  const value = heir.daysInYear;
  console.log("Temporal.PlainDateTime.prototype.daysInYear of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDateTime.prototype.daysInYear by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDateTime.prototype, "daysInYear").get.call({ plain: true });
  console.log("Temporal.PlainDateTime.prototype.daysInYear by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDateTime.prototype.era of an heir", () => {
  const heir = Object.create(Temporal.PlainDateTime.prototype);
  const value = heir.era;
  console.log("Temporal.PlainDateTime.prototype.era of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDateTime.prototype.era by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDateTime.prototype, "era").get.call({ plain: true });
  console.log("Temporal.PlainDateTime.prototype.era by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDateTime.prototype.eraYear of an heir", () => {
  const heir = Object.create(Temporal.PlainDateTime.prototype);
  const value = heir.eraYear;
  console.log("Temporal.PlainDateTime.prototype.eraYear of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDateTime.prototype.eraYear by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDateTime.prototype, "eraYear").get.call({ plain: true });
  console.log("Temporal.PlainDateTime.prototype.eraYear by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDateTime.prototype.hour of an heir", () => {
  const heir = Object.create(Temporal.PlainDateTime.prototype);
  const value = heir.hour;
  console.log("Temporal.PlainDateTime.prototype.hour of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDateTime.prototype.hour by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDateTime.prototype, "hour").get.call({ plain: true });
  console.log("Temporal.PlainDateTime.prototype.hour by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDateTime.prototype.inLeapYear of an heir", () => {
  const heir = Object.create(Temporal.PlainDateTime.prototype);
  const value = heir.inLeapYear;
  console.log("Temporal.PlainDateTime.prototype.inLeapYear of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDateTime.prototype.inLeapYear by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDateTime.prototype, "inLeapYear").get.call({ plain: true });
  console.log("Temporal.PlainDateTime.prototype.inLeapYear by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDateTime.prototype.microsecond of an heir", () => {
  const heir = Object.create(Temporal.PlainDateTime.prototype);
  const value = heir.microsecond;
  console.log("Temporal.PlainDateTime.prototype.microsecond of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDateTime.prototype.microsecond by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDateTime.prototype, "microsecond").get.call({ plain: true });
  console.log("Temporal.PlainDateTime.prototype.microsecond by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDateTime.prototype.millisecond of an heir", () => {
  const heir = Object.create(Temporal.PlainDateTime.prototype);
  const value = heir.millisecond;
  console.log("Temporal.PlainDateTime.prototype.millisecond of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDateTime.prototype.millisecond by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDateTime.prototype, "millisecond").get.call({ plain: true });
  console.log("Temporal.PlainDateTime.prototype.millisecond by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDateTime.prototype.minute of an heir", () => {
  const heir = Object.create(Temporal.PlainDateTime.prototype);
  const value = heir.minute;
  console.log("Temporal.PlainDateTime.prototype.minute of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDateTime.prototype.minute by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDateTime.prototype, "minute").get.call({ plain: true });
  console.log("Temporal.PlainDateTime.prototype.minute by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDateTime.prototype.month of an heir", () => {
  const heir = Object.create(Temporal.PlainDateTime.prototype);
  const value = heir.month;
  console.log("Temporal.PlainDateTime.prototype.month of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDateTime.prototype.month by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDateTime.prototype, "month").get.call({ plain: true });
  console.log("Temporal.PlainDateTime.prototype.month by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDateTime.prototype.monthCode of an heir", () => {
  const heir = Object.create(Temporal.PlainDateTime.prototype);
  const value = heir.monthCode;
  console.log("Temporal.PlainDateTime.prototype.monthCode of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDateTime.prototype.monthCode by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDateTime.prototype, "monthCode").get.call({ plain: true });
  console.log("Temporal.PlainDateTime.prototype.monthCode by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDateTime.prototype.monthsInYear of an heir", () => {
  const heir = Object.create(Temporal.PlainDateTime.prototype);
  const value = heir.monthsInYear;
  console.log("Temporal.PlainDateTime.prototype.monthsInYear of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDateTime.prototype.monthsInYear by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDateTime.prototype, "monthsInYear").get.call({ plain: true });
  console.log("Temporal.PlainDateTime.prototype.monthsInYear by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDateTime.prototype.nanosecond of an heir", () => {
  const heir = Object.create(Temporal.PlainDateTime.prototype);
  const value = heir.nanosecond;
  console.log("Temporal.PlainDateTime.prototype.nanosecond of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDateTime.prototype.nanosecond by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDateTime.prototype, "nanosecond").get.call({ plain: true });
  console.log("Temporal.PlainDateTime.prototype.nanosecond by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDateTime.prototype.second of an heir", () => {
  const heir = Object.create(Temporal.PlainDateTime.prototype);
  const value = heir.second;
  console.log("Temporal.PlainDateTime.prototype.second of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDateTime.prototype.second by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDateTime.prototype, "second").get.call({ plain: true });
  console.log("Temporal.PlainDateTime.prototype.second by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDateTime.prototype.weekOfYear of an heir", () => {
  const heir = Object.create(Temporal.PlainDateTime.prototype);
  const value = heir.weekOfYear;
  console.log("Temporal.PlainDateTime.prototype.weekOfYear of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDateTime.prototype.weekOfYear by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDateTime.prototype, "weekOfYear").get.call({ plain: true });
  console.log("Temporal.PlainDateTime.prototype.weekOfYear by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDateTime.prototype.year of an heir", () => {
  const heir = Object.create(Temporal.PlainDateTime.prototype);
  const value = heir.year;
  console.log("Temporal.PlainDateTime.prototype.year of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDateTime.prototype.year by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDateTime.prototype, "year").get.call({ plain: true });
  console.log("Temporal.PlainDateTime.prototype.year by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainDateTime.prototype.yearOfWeek of an heir", () => {
  const heir = Object.create(Temporal.PlainDateTime.prototype);
  const value = heir.yearOfWeek;
  console.log("Temporal.PlainDateTime.prototype.yearOfWeek of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainDateTime.prototype.yearOfWeek by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainDateTime.prototype, "yearOfWeek").get.call({ plain: true });
  console.log("Temporal.PlainDateTime.prototype.yearOfWeek by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainMonthDay.prototype.calendarId of an heir", () => {
  const heir = Object.create(Temporal.PlainMonthDay.prototype);
  const value = heir.calendarId;
  console.log("Temporal.PlainMonthDay.prototype.calendarId of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainMonthDay.prototype.calendarId by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainMonthDay.prototype, "calendarId").get.call({ plain: true });
  console.log("Temporal.PlainMonthDay.prototype.calendarId by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainMonthDay.prototype.day of an heir", () => {
  const heir = Object.create(Temporal.PlainMonthDay.prototype);
  const value = heir.day;
  console.log("Temporal.PlainMonthDay.prototype.day of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainMonthDay.prototype.day by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainMonthDay.prototype, "day").get.call({ plain: true });
  console.log("Temporal.PlainMonthDay.prototype.day by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainMonthDay.prototype.monthCode of an heir", () => {
  const heir = Object.create(Temporal.PlainMonthDay.prototype);
  const value = heir.monthCode;
  console.log("Temporal.PlainMonthDay.prototype.monthCode of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainMonthDay.prototype.monthCode by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainMonthDay.prototype, "monthCode").get.call({ plain: true });
  console.log("Temporal.PlainMonthDay.prototype.monthCode by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainTime.prototype.hour of an heir", () => {
  const heir = Object.create(Temporal.PlainTime.prototype);
  const value = heir.hour;
  console.log("Temporal.PlainTime.prototype.hour of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainTime.prototype.hour by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainTime.prototype, "hour").get.call({ plain: true });
  console.log("Temporal.PlainTime.prototype.hour by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainTime.prototype.microsecond of an heir", () => {
  const heir = Object.create(Temporal.PlainTime.prototype);
  const value = heir.microsecond;
  console.log("Temporal.PlainTime.prototype.microsecond of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainTime.prototype.microsecond by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainTime.prototype, "microsecond").get.call({ plain: true });
  console.log("Temporal.PlainTime.prototype.microsecond by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainTime.prototype.millisecond of an heir", () => {
  const heir = Object.create(Temporal.PlainTime.prototype);
  const value = heir.millisecond;
  console.log("Temporal.PlainTime.prototype.millisecond of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainTime.prototype.millisecond by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainTime.prototype, "millisecond").get.call({ plain: true });
  console.log("Temporal.PlainTime.prototype.millisecond by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainTime.prototype.minute of an heir", () => {
  const heir = Object.create(Temporal.PlainTime.prototype);
  const value = heir.minute;
  console.log("Temporal.PlainTime.prototype.minute of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainTime.prototype.minute by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainTime.prototype, "minute").get.call({ plain: true });
  console.log("Temporal.PlainTime.prototype.minute by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainTime.prototype.nanosecond of an heir", () => {
  const heir = Object.create(Temporal.PlainTime.prototype);
  const value = heir.nanosecond;
  console.log("Temporal.PlainTime.prototype.nanosecond of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainTime.prototype.nanosecond by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainTime.prototype, "nanosecond").get.call({ plain: true });
  console.log("Temporal.PlainTime.prototype.nanosecond by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainTime.prototype.second of an heir", () => {
  const heir = Object.create(Temporal.PlainTime.prototype);
  const value = heir.second;
  console.log("Temporal.PlainTime.prototype.second of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainTime.prototype.second by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainTime.prototype, "second").get.call({ plain: true });
  console.log("Temporal.PlainTime.prototype.second by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainYearMonth.prototype.calendarId of an heir", () => {
  const heir = Object.create(Temporal.PlainYearMonth.prototype);
  const value = heir.calendarId;
  console.log("Temporal.PlainYearMonth.prototype.calendarId of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainYearMonth.prototype.calendarId by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainYearMonth.prototype, "calendarId").get.call({ plain: true });
  console.log("Temporal.PlainYearMonth.prototype.calendarId by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainYearMonth.prototype.daysInMonth of an heir", () => {
  const heir = Object.create(Temporal.PlainYearMonth.prototype);
  const value = heir.daysInMonth;
  console.log("Temporal.PlainYearMonth.prototype.daysInMonth of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainYearMonth.prototype.daysInMonth by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainYearMonth.prototype, "daysInMonth").get.call({ plain: true });
  console.log("Temporal.PlainYearMonth.prototype.daysInMonth by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainYearMonth.prototype.daysInYear of an heir", () => {
  const heir = Object.create(Temporal.PlainYearMonth.prototype);
  const value = heir.daysInYear;
  console.log("Temporal.PlainYearMonth.prototype.daysInYear of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainYearMonth.prototype.daysInYear by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainYearMonth.prototype, "daysInYear").get.call({ plain: true });
  console.log("Temporal.PlainYearMonth.prototype.daysInYear by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainYearMonth.prototype.era of an heir", () => {
  const heir = Object.create(Temporal.PlainYearMonth.prototype);
  const value = heir.era;
  console.log("Temporal.PlainYearMonth.prototype.era of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainYearMonth.prototype.era by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainYearMonth.prototype, "era").get.call({ plain: true });
  console.log("Temporal.PlainYearMonth.prototype.era by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainYearMonth.prototype.eraYear of an heir", () => {
  const heir = Object.create(Temporal.PlainYearMonth.prototype);
  const value = heir.eraYear;
  console.log("Temporal.PlainYearMonth.prototype.eraYear of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainYearMonth.prototype.eraYear by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainYearMonth.prototype, "eraYear").get.call({ plain: true });
  console.log("Temporal.PlainYearMonth.prototype.eraYear by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainYearMonth.prototype.inLeapYear of an heir", () => {
  const heir = Object.create(Temporal.PlainYearMonth.prototype);
  const value = heir.inLeapYear;
  console.log("Temporal.PlainYearMonth.prototype.inLeapYear of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainYearMonth.prototype.inLeapYear by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainYearMonth.prototype, "inLeapYear").get.call({ plain: true });
  console.log("Temporal.PlainYearMonth.prototype.inLeapYear by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainYearMonth.prototype.month of an heir", () => {
  const heir = Object.create(Temporal.PlainYearMonth.prototype);
  const value = heir.month;
  console.log("Temporal.PlainYearMonth.prototype.month of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainYearMonth.prototype.month by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainYearMonth.prototype, "month").get.call({ plain: true });
  console.log("Temporal.PlainYearMonth.prototype.month by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainYearMonth.prototype.monthCode of an heir", () => {
  const heir = Object.create(Temporal.PlainYearMonth.prototype);
  const value = heir.monthCode;
  console.log("Temporal.PlainYearMonth.prototype.monthCode of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainYearMonth.prototype.monthCode by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainYearMonth.prototype, "monthCode").get.call({ plain: true });
  console.log("Temporal.PlainYearMonth.prototype.monthCode by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainYearMonth.prototype.monthsInYear of an heir", () => {
  const heir = Object.create(Temporal.PlainYearMonth.prototype);
  const value = heir.monthsInYear;
  console.log("Temporal.PlainYearMonth.prototype.monthsInYear of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainYearMonth.prototype.monthsInYear by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainYearMonth.prototype, "monthsInYear").get.call({ plain: true });
  console.log("Temporal.PlainYearMonth.prototype.monthsInYear by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.PlainYearMonth.prototype.year of an heir", () => {
  const heir = Object.create(Temporal.PlainYearMonth.prototype);
  const value = heir.year;
  console.log("Temporal.PlainYearMonth.prototype.year of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.PlainYearMonth.prototype.year by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.PlainYearMonth.prototype, "year").get.call({ plain: true });
  console.log("Temporal.PlainYearMonth.prototype.year by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.ZonedDateTime.prototype.calendarId of an heir", () => {
  const heir = Object.create(Temporal.ZonedDateTime.prototype);
  const value = heir.calendarId;
  console.log("Temporal.ZonedDateTime.prototype.calendarId of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.ZonedDateTime.prototype.calendarId by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype, "calendarId").get.call({ plain: true });
  console.log("Temporal.ZonedDateTime.prototype.calendarId by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.ZonedDateTime.prototype.day of an heir", () => {
  const heir = Object.create(Temporal.ZonedDateTime.prototype);
  const value = heir.day;
  console.log("Temporal.ZonedDateTime.prototype.day of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.ZonedDateTime.prototype.day by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype, "day").get.call({ plain: true });
  console.log("Temporal.ZonedDateTime.prototype.day by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.ZonedDateTime.prototype.dayOfWeek of an heir", () => {
  const heir = Object.create(Temporal.ZonedDateTime.prototype);
  const value = heir.dayOfWeek;
  console.log("Temporal.ZonedDateTime.prototype.dayOfWeek of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.ZonedDateTime.prototype.dayOfWeek by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype, "dayOfWeek").get.call({ plain: true });
  console.log("Temporal.ZonedDateTime.prototype.dayOfWeek by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.ZonedDateTime.prototype.dayOfYear of an heir", () => {
  const heir = Object.create(Temporal.ZonedDateTime.prototype);
  const value = heir.dayOfYear;
  console.log("Temporal.ZonedDateTime.prototype.dayOfYear of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.ZonedDateTime.prototype.dayOfYear by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype, "dayOfYear").get.call({ plain: true });
  console.log("Temporal.ZonedDateTime.prototype.dayOfYear by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.ZonedDateTime.prototype.daysInMonth of an heir", () => {
  const heir = Object.create(Temporal.ZonedDateTime.prototype);
  const value = heir.daysInMonth;
  console.log("Temporal.ZonedDateTime.prototype.daysInMonth of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.ZonedDateTime.prototype.daysInMonth by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype, "daysInMonth").get.call({ plain: true });
  console.log("Temporal.ZonedDateTime.prototype.daysInMonth by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.ZonedDateTime.prototype.daysInWeek of an heir", () => {
  const heir = Object.create(Temporal.ZonedDateTime.prototype);
  const value = heir.daysInWeek;
  console.log("Temporal.ZonedDateTime.prototype.daysInWeek of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.ZonedDateTime.prototype.daysInWeek by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype, "daysInWeek").get.call({ plain: true });
  console.log("Temporal.ZonedDateTime.prototype.daysInWeek by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.ZonedDateTime.prototype.daysInYear of an heir", () => {
  const heir = Object.create(Temporal.ZonedDateTime.prototype);
  const value = heir.daysInYear;
  console.log("Temporal.ZonedDateTime.prototype.daysInYear of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.ZonedDateTime.prototype.daysInYear by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype, "daysInYear").get.call({ plain: true });
  console.log("Temporal.ZonedDateTime.prototype.daysInYear by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.ZonedDateTime.prototype.epochMilliseconds of an heir", () => {
  const heir = Object.create(Temporal.ZonedDateTime.prototype);
  const value = heir.epochMilliseconds;
  console.log("Temporal.ZonedDateTime.prototype.epochMilliseconds of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.ZonedDateTime.prototype.epochMilliseconds by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype, "epochMilliseconds").get.call({ plain: true });
  console.log("Temporal.ZonedDateTime.prototype.epochMilliseconds by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.ZonedDateTime.prototype.epochNanoseconds of an heir", () => {
  const heir = Object.create(Temporal.ZonedDateTime.prototype);
  const value = heir.epochNanoseconds;
  console.log("Temporal.ZonedDateTime.prototype.epochNanoseconds of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.ZonedDateTime.prototype.epochNanoseconds by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype, "epochNanoseconds").get.call({ plain: true });
  console.log("Temporal.ZonedDateTime.prototype.epochNanoseconds by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.ZonedDateTime.prototype.era of an heir", () => {
  const heir = Object.create(Temporal.ZonedDateTime.prototype);
  const value = heir.era;
  console.log("Temporal.ZonedDateTime.prototype.era of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.ZonedDateTime.prototype.era by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype, "era").get.call({ plain: true });
  console.log("Temporal.ZonedDateTime.prototype.era by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.ZonedDateTime.prototype.eraYear of an heir", () => {
  const heir = Object.create(Temporal.ZonedDateTime.prototype);
  const value = heir.eraYear;
  console.log("Temporal.ZonedDateTime.prototype.eraYear of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.ZonedDateTime.prototype.eraYear by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype, "eraYear").get.call({ plain: true });
  console.log("Temporal.ZonedDateTime.prototype.eraYear by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.ZonedDateTime.prototype.hour of an heir", () => {
  const heir = Object.create(Temporal.ZonedDateTime.prototype);
  const value = heir.hour;
  console.log("Temporal.ZonedDateTime.prototype.hour of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.ZonedDateTime.prototype.hour by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype, "hour").get.call({ plain: true });
  console.log("Temporal.ZonedDateTime.prototype.hour by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.ZonedDateTime.prototype.hoursInDay of an heir", () => {
  const heir = Object.create(Temporal.ZonedDateTime.prototype);
  const value = heir.hoursInDay;
  console.log("Temporal.ZonedDateTime.prototype.hoursInDay of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.ZonedDateTime.prototype.hoursInDay by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype, "hoursInDay").get.call({ plain: true });
  console.log("Temporal.ZonedDateTime.prototype.hoursInDay by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.ZonedDateTime.prototype.inLeapYear of an heir", () => {
  const heir = Object.create(Temporal.ZonedDateTime.prototype);
  const value = heir.inLeapYear;
  console.log("Temporal.ZonedDateTime.prototype.inLeapYear of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.ZonedDateTime.prototype.inLeapYear by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype, "inLeapYear").get.call({ plain: true });
  console.log("Temporal.ZonedDateTime.prototype.inLeapYear by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.ZonedDateTime.prototype.microsecond of an heir", () => {
  const heir = Object.create(Temporal.ZonedDateTime.prototype);
  const value = heir.microsecond;
  console.log("Temporal.ZonedDateTime.prototype.microsecond of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.ZonedDateTime.prototype.microsecond by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype, "microsecond").get.call({ plain: true });
  console.log("Temporal.ZonedDateTime.prototype.microsecond by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.ZonedDateTime.prototype.millisecond of an heir", () => {
  const heir = Object.create(Temporal.ZonedDateTime.prototype);
  const value = heir.millisecond;
  console.log("Temporal.ZonedDateTime.prototype.millisecond of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.ZonedDateTime.prototype.millisecond by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype, "millisecond").get.call({ plain: true });
  console.log("Temporal.ZonedDateTime.prototype.millisecond by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.ZonedDateTime.prototype.minute of an heir", () => {
  const heir = Object.create(Temporal.ZonedDateTime.prototype);
  const value = heir.minute;
  console.log("Temporal.ZonedDateTime.prototype.minute of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.ZonedDateTime.prototype.minute by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype, "minute").get.call({ plain: true });
  console.log("Temporal.ZonedDateTime.prototype.minute by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.ZonedDateTime.prototype.month of an heir", () => {
  const heir = Object.create(Temporal.ZonedDateTime.prototype);
  const value = heir.month;
  console.log("Temporal.ZonedDateTime.prototype.month of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.ZonedDateTime.prototype.month by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype, "month").get.call({ plain: true });
  console.log("Temporal.ZonedDateTime.prototype.month by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.ZonedDateTime.prototype.monthCode of an heir", () => {
  const heir = Object.create(Temporal.ZonedDateTime.prototype);
  const value = heir.monthCode;
  console.log("Temporal.ZonedDateTime.prototype.monthCode of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.ZonedDateTime.prototype.monthCode by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype, "monthCode").get.call({ plain: true });
  console.log("Temporal.ZonedDateTime.prototype.monthCode by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.ZonedDateTime.prototype.monthsInYear of an heir", () => {
  const heir = Object.create(Temporal.ZonedDateTime.prototype);
  const value = heir.monthsInYear;
  console.log("Temporal.ZonedDateTime.prototype.monthsInYear of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.ZonedDateTime.prototype.monthsInYear by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype, "monthsInYear").get.call({ plain: true });
  console.log("Temporal.ZonedDateTime.prototype.monthsInYear by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.ZonedDateTime.prototype.nanosecond of an heir", () => {
  const heir = Object.create(Temporal.ZonedDateTime.prototype);
  const value = heir.nanosecond;
  console.log("Temporal.ZonedDateTime.prototype.nanosecond of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.ZonedDateTime.prototype.nanosecond by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype, "nanosecond").get.call({ plain: true });
  console.log("Temporal.ZonedDateTime.prototype.nanosecond by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.ZonedDateTime.prototype.offset of an heir", () => {
  const heir = Object.create(Temporal.ZonedDateTime.prototype);
  const value = heir.offset;
  console.log("Temporal.ZonedDateTime.prototype.offset of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.ZonedDateTime.prototype.offset by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype, "offset").get.call({ plain: true });
  console.log("Temporal.ZonedDateTime.prototype.offset by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.ZonedDateTime.prototype.offsetNanoseconds of an heir", () => {
  const heir = Object.create(Temporal.ZonedDateTime.prototype);
  const value = heir.offsetNanoseconds;
  console.log("Temporal.ZonedDateTime.prototype.offsetNanoseconds of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.ZonedDateTime.prototype.offsetNanoseconds by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype, "offsetNanoseconds").get.call({ plain: true });
  console.log("Temporal.ZonedDateTime.prototype.offsetNanoseconds by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.ZonedDateTime.prototype.second of an heir", () => {
  const heir = Object.create(Temporal.ZonedDateTime.prototype);
  const value = heir.second;
  console.log("Temporal.ZonedDateTime.prototype.second of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.ZonedDateTime.prototype.second by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype, "second").get.call({ plain: true });
  console.log("Temporal.ZonedDateTime.prototype.second by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.ZonedDateTime.prototype.timeZoneId of an heir", () => {
  const heir = Object.create(Temporal.ZonedDateTime.prototype);
  const value = heir.timeZoneId;
  console.log("Temporal.ZonedDateTime.prototype.timeZoneId of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.ZonedDateTime.prototype.timeZoneId by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype, "timeZoneId").get.call({ plain: true });
  console.log("Temporal.ZonedDateTime.prototype.timeZoneId by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.ZonedDateTime.prototype.weekOfYear of an heir", () => {
  const heir = Object.create(Temporal.ZonedDateTime.prototype);
  const value = heir.weekOfYear;
  console.log("Temporal.ZonedDateTime.prototype.weekOfYear of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.ZonedDateTime.prototype.weekOfYear by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype, "weekOfYear").get.call({ plain: true });
  console.log("Temporal.ZonedDateTime.prototype.weekOfYear by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.ZonedDateTime.prototype.year of an heir", () => {
  const heir = Object.create(Temporal.ZonedDateTime.prototype);
  const value = heir.year;
  console.log("Temporal.ZonedDateTime.prototype.year of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.ZonedDateTime.prototype.year by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype, "year").get.call({ plain: true });
  console.log("Temporal.ZonedDateTime.prototype.year by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("Temporal.ZonedDateTime.prototype.yearOfWeek of an heir", () => {
  const heir = Object.create(Temporal.ZonedDateTime.prototype);
  const value = heir.yearOfWeek;
  console.log("Temporal.ZonedDateTime.prototype.yearOfWeek of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("Temporal.ZonedDateTime.prototype.yearOfWeek by hand", () => {
  const value = Object.getOwnPropertyDescriptor(Temporal.ZonedDateTime.prototype, "yearOfWeek").get.call({ plain: true });
  console.log("Temporal.ZonedDateTime.prototype.yearOfWeek by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("WebAssembly.Exception.prototype.stack of an heir", () => {
  const heir = Object.create(WebAssembly.Exception.prototype);
  const value = heir.stack;
  console.log("WebAssembly.Exception.prototype.stack of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("WebAssembly.Exception.prototype.stack by hand", () => {
  const value = Object.getOwnPropertyDescriptor(WebAssembly.Exception.prototype, "stack").get.call({ plain: true });
  console.log("WebAssembly.Exception.prototype.stack by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("WebAssembly.Global.prototype.value of an heir", () => {
  const heir = Object.create(WebAssembly.Global.prototype);
  const value = heir.value;
  console.log("WebAssembly.Global.prototype.value of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("WebAssembly.Global.prototype.value by hand", () => {
  const value = Object.getOwnPropertyDescriptor(WebAssembly.Global.prototype, "value").get.call({ plain: true });
  console.log("WebAssembly.Global.prototype.value by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("WebAssembly.Global.prototype.value stored on an heir", () => {
  const heir = Object.create(WebAssembly.Global.prototype);
  heir.value = "stored";
  console.log("WebAssembly.Global.prototype.value stored on an heir", Object.keys(heir).join(), Object.hasOwn(heir, "value"));
});
attempt("WebAssembly.Instance.prototype.exports of an heir", () => {
  const heir = Object.create(WebAssembly.Instance.prototype);
  const value = heir.exports;
  console.log("WebAssembly.Instance.prototype.exports of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("WebAssembly.Instance.prototype.exports by hand", () => {
  const value = Object.getOwnPropertyDescriptor(WebAssembly.Instance.prototype, "exports").get.call({ plain: true });
  console.log("WebAssembly.Instance.prototype.exports by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("WebAssembly.Memory.prototype.buffer of an heir", () => {
  const heir = Object.create(WebAssembly.Memory.prototype);
  const value = heir.buffer;
  console.log("WebAssembly.Memory.prototype.buffer of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("WebAssembly.Memory.prototype.buffer by hand", () => {
  const value = Object.getOwnPropertyDescriptor(WebAssembly.Memory.prototype, "buffer").get.call({ plain: true });
  console.log("WebAssembly.Memory.prototype.buffer by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
attempt("WebAssembly.Table.prototype.length of an heir", () => {
  const heir = Object.create(WebAssembly.Table.prototype);
  const value = heir.length;
  console.log("WebAssembly.Table.prototype.length of an heir", typeof value, value === undefined, value === null, typeof value === "string", typeof value === "number", typeof value === "boolean", typeof value === "object", typeof value === "function");
});
attempt("WebAssembly.Table.prototype.length by hand", () => {
  const value = Object.getOwnPropertyDescriptor(WebAssembly.Table.prototype, "length").get.call({ plain: true });
  console.log("WebAssembly.Table.prototype.length by hand", typeof value, value === undefined, typeof value === "string", typeof value === "number", typeof value === "object");
});
console.log("255 accessors");
setTimeout(() => process.exit(0), 30);
