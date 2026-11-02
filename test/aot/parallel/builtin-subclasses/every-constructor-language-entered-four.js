// Every constructor of the language entered in four ways, each site spelled out: `new X(..)`, `super(..)` from a class below X, Reflect.construct(X, [..], Other), Reflect.construct(X, [..]). What is made lies below new.target's prototype, is of X's kind, is never an operand but for `new Object(object)`, and takes the fields of the class.
function describe(label, made, constructor, prototype, first) {
  let brand;
  try { brand = Object.prototype.toString.call(made); } catch (error) { brand = "throws"; }
  console.log(label, typeof made, brand, made instanceof constructor, Object.getPrototypeOf(made) === prototype, made === first, Object.getOwnPropertyNames(made).filter(name => name !== "stack" && name !== "line" && name !== "column" && name !== "sourceURL").join());
}
function attempt(label, run) {
  try { run(); } catch (error) { console.log(label, "throws", error.constructor.name); }
}

class BelowObject extends Object {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherObject() {}
OtherObject.prototype.mark = "Object";
attempt("Object new", () => {
  const first = { given: true };
  const made = new Object(first);
  made.extra = 1;
  describe("Object new", made, Object, Object.prototype, first);
  console.log(made.extra);
});
attempt("Object super", () => {
  const first = { given: true };
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowObject(first, i);
    sum += made.own();
  }
  describe("Object super", made, Object, BelowObject.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowObject);
});
attempt("Object reflected", () => {
  const first = { given: true };
  const made = Reflect.construct(Object, [first], OtherObject);
  made.extra = 1;
  describe("Object reflected", made, Object, OtherObject.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("Object reflected for itself", () => {
  const first = { given: true };
  const made = Reflect.construct(Object, [first]);
  describe("Object reflected for itself", made, Object, Object.prototype, first);
});

class BelowObjectOfNumber extends Object {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherObjectOfNumber() {}
OtherObjectOfNumber.prototype.mark = "ObjectOfNumber";
attempt("ObjectOfNumber new", () => {
  const first = 5;
  const made = new Object(first);
  made.extra = 1;
  describe("ObjectOfNumber new", made, Object, Object.prototype, first);
  console.log(made.extra);
});
attempt("ObjectOfNumber super", () => {
  const first = 5;
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowObjectOfNumber(first, i);
    sum += made.own();
  }
  describe("ObjectOfNumber super", made, Object, BelowObjectOfNumber.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowObjectOfNumber);
});
attempt("ObjectOfNumber reflected", () => {
  const first = 5;
  const made = Reflect.construct(Object, [first], OtherObjectOfNumber);
  made.extra = 1;
  describe("ObjectOfNumber reflected", made, Object, OtherObjectOfNumber.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("ObjectOfNumber reflected for itself", () => {
  const first = 5;
  const made = Reflect.construct(Object, [first]);
  describe("ObjectOfNumber reflected for itself", made, Object, Object.prototype, first);
});

class BelowObjectOfText extends Object {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherObjectOfText() {}
OtherObjectOfText.prototype.mark = "ObjectOfText";
attempt("ObjectOfText new", () => {
  const first = "text";
  const made = new Object(first);
  made.extra = 1;
  describe("ObjectOfText new", made, Object, Object.prototype, first);
  console.log(made.extra);
});
attempt("ObjectOfText super", () => {
  const first = "text";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowObjectOfText(first, i);
    sum += made.own();
  }
  describe("ObjectOfText super", made, Object, BelowObjectOfText.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowObjectOfText);
});
attempt("ObjectOfText reflected", () => {
  const first = "text";
  const made = Reflect.construct(Object, [first], OtherObjectOfText);
  made.extra = 1;
  describe("ObjectOfText reflected", made, Object, OtherObjectOfText.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("ObjectOfText reflected for itself", () => {
  const first = "text";
  const made = Reflect.construct(Object, [first]);
  describe("ObjectOfText reflected for itself", made, Object, Object.prototype, first);
});

class BelowObjectOfNothing extends Object {
  tag;
  constructor(tag) {
    super();
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherObjectOfNothing() {}
OtherObjectOfNothing.prototype.mark = "ObjectOfNothing";
attempt("ObjectOfNothing new", () => {
  const made = new Object();
  made.extra = 1;
  describe("ObjectOfNothing new", made, Object, Object.prototype, undefined);
  console.log(made.extra);
});
attempt("ObjectOfNothing super", () => {
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowObjectOfNothing(i);
    sum += made.own();
  }
  describe("ObjectOfNothing super", made, Object, BelowObjectOfNothing.prototype, undefined);
  console.log(sum, made.tag, made.late, made instanceof BelowObjectOfNothing);
});
attempt("ObjectOfNothing reflected", () => {
  const made = Reflect.construct(Object, [], OtherObjectOfNothing);
  made.extra = 1;
  describe("ObjectOfNothing reflected", made, Object, OtherObjectOfNothing.prototype, undefined);
  console.log(made.mark, made.extra);
});
attempt("ObjectOfNothing reflected for itself", () => {
  const made = Reflect.construct(Object, []);
  describe("ObjectOfNothing reflected for itself", made, Object, Object.prototype, undefined);
});

class BelowArrayOfLength extends Array {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherArrayOfLength() {}
OtherArrayOfLength.prototype.mark = "ArrayOfLength";
attempt("ArrayOfLength new", () => {
  const first = 3;
  const made = new Array(first);
  made.extra = 1;
  describe("ArrayOfLength new", made, Array, Array.prototype, first);
  console.log(made.extra);
});
attempt("ArrayOfLength super", () => {
  const first = 3;
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowArrayOfLength(first, i);
    sum += made.own();
  }
  describe("ArrayOfLength super", made, Array, BelowArrayOfLength.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowArrayOfLength);
});
attempt("ArrayOfLength reflected", () => {
  const first = 3;
  const made = Reflect.construct(Array, [first], OtherArrayOfLength);
  made.extra = 1;
  describe("ArrayOfLength reflected", made, Array, OtherArrayOfLength.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("ArrayOfLength reflected for itself", () => {
  const first = 3;
  const made = Reflect.construct(Array, [first]);
  describe("ArrayOfLength reflected for itself", made, Array, Array.prototype, first);
});

class BelowArrayOfItems extends Array {
  tag;
  constructor(first, second, third, tag) {
    super(first, second, third);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherArrayOfItems() {}
OtherArrayOfItems.prototype.mark = "ArrayOfItems";
attempt("ArrayOfItems new", () => {
  const first = 1;
  const second = 2;
  const third = 3;
  const made = new Array(first, second, third);
  made.extra = 1;
  describe("ArrayOfItems new", made, Array, Array.prototype, first);
  console.log(made.extra);
});
attempt("ArrayOfItems super", () => {
  const first = 1;
  const second = 2;
  const third = 3;
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowArrayOfItems(first, second, third, i);
    sum += made.own();
  }
  describe("ArrayOfItems super", made, Array, BelowArrayOfItems.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowArrayOfItems);
});
attempt("ArrayOfItems reflected", () => {
  const first = 1;
  const second = 2;
  const third = 3;
  const made = Reflect.construct(Array, [first, second, third], OtherArrayOfItems);
  made.extra = 1;
  describe("ArrayOfItems reflected", made, Array, OtherArrayOfItems.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("ArrayOfItems reflected for itself", () => {
  const first = 1;
  const second = 2;
  const third = 3;
  const made = Reflect.construct(Array, [first, second, third]);
  describe("ArrayOfItems reflected for itself", made, Array, Array.prototype, first);
});

class BelowArrayBuffer extends ArrayBuffer {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherArrayBuffer() {}
OtherArrayBuffer.prototype.mark = "ArrayBuffer";
attempt("ArrayBuffer new", () => {
  const first = 8;
  const made = new ArrayBuffer(first);
  made.extra = 1;
  describe("ArrayBuffer new", made, ArrayBuffer, ArrayBuffer.prototype, first);
  console.log(made.extra);
});
attempt("ArrayBuffer super", () => {
  const first = 8;
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowArrayBuffer(first, i);
    sum += made.own();
  }
  describe("ArrayBuffer super", made, ArrayBuffer, BelowArrayBuffer.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowArrayBuffer);
});
attempt("ArrayBuffer reflected", () => {
  const first = 8;
  const made = Reflect.construct(ArrayBuffer, [first], OtherArrayBuffer);
  made.extra = 1;
  describe("ArrayBuffer reflected", made, ArrayBuffer, OtherArrayBuffer.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("ArrayBuffer reflected for itself", () => {
  const first = 8;
  const made = Reflect.construct(ArrayBuffer, [first]);
  describe("ArrayBuffer reflected for itself", made, ArrayBuffer, ArrayBuffer.prototype, first);
});

class BelowSharedArrayBuffer extends SharedArrayBuffer {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherSharedArrayBuffer() {}
OtherSharedArrayBuffer.prototype.mark = "SharedArrayBuffer";
attempt("SharedArrayBuffer new", () => {
  const first = 8;
  const made = new SharedArrayBuffer(first);
  made.extra = 1;
  describe("SharedArrayBuffer new", made, SharedArrayBuffer, SharedArrayBuffer.prototype, first);
  console.log(made.extra);
});
attempt("SharedArrayBuffer super", () => {
  const first = 8;
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowSharedArrayBuffer(first, i);
    sum += made.own();
  }
  describe("SharedArrayBuffer super", made, SharedArrayBuffer, BelowSharedArrayBuffer.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowSharedArrayBuffer);
});
attempt("SharedArrayBuffer reflected", () => {
  const first = 8;
  const made = Reflect.construct(SharedArrayBuffer, [first], OtherSharedArrayBuffer);
  made.extra = 1;
  describe("SharedArrayBuffer reflected", made, SharedArrayBuffer, OtherSharedArrayBuffer.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("SharedArrayBuffer reflected for itself", () => {
  const first = 8;
  const made = Reflect.construct(SharedArrayBuffer, [first]);
  describe("SharedArrayBuffer reflected for itself", made, SharedArrayBuffer, SharedArrayBuffer.prototype, first);
});

class BelowBoolean extends Boolean {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherBoolean() {}
OtherBoolean.prototype.mark = "Boolean";
attempt("Boolean new", () => {
  const first = true;
  const made = new Boolean(first);
  made.extra = 1;
  describe("Boolean new", made, Boolean, Boolean.prototype, first);
  console.log(made.extra);
});
attempt("Boolean super", () => {
  const first = true;
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowBoolean(first, i);
    sum += made.own();
  }
  describe("Boolean super", made, Boolean, BelowBoolean.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowBoolean);
});
attempt("Boolean reflected", () => {
  const first = true;
  const made = Reflect.construct(Boolean, [first], OtherBoolean);
  made.extra = 1;
  describe("Boolean reflected", made, Boolean, OtherBoolean.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("Boolean reflected for itself", () => {
  const first = true;
  const made = Reflect.construct(Boolean, [first]);
  describe("Boolean reflected for itself", made, Boolean, Boolean.prototype, first);
});

class BelowNumber extends Number {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherNumber() {}
OtherNumber.prototype.mark = "Number";
attempt("Number new", () => {
  const first = 5;
  const made = new Number(first);
  made.extra = 1;
  describe("Number new", made, Number, Number.prototype, first);
  console.log(made.extra);
});
attempt("Number super", () => {
  const first = 5;
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowNumber(first, i);
    sum += made.own();
  }
  describe("Number super", made, Number, BelowNumber.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowNumber);
});
attempt("Number reflected", () => {
  const first = 5;
  const made = Reflect.construct(Number, [first], OtherNumber);
  made.extra = 1;
  describe("Number reflected", made, Number, OtherNumber.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("Number reflected for itself", () => {
  const first = 5;
  const made = Reflect.construct(Number, [first]);
  describe("Number reflected for itself", made, Number, Number.prototype, first);
});

class BelowString extends String {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherString() {}
OtherString.prototype.mark = "String";
attempt("String new", () => {
  const first = "text";
  const made = new String(first);
  made.extra = 1;
  describe("String new", made, String, String.prototype, first);
  console.log(made.extra);
});
attempt("String super", () => {
  const first = "text";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowString(first, i);
    sum += made.own();
  }
  describe("String super", made, String, BelowString.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowString);
});
attempt("String reflected", () => {
  const first = "text";
  const made = Reflect.construct(String, [first], OtherString);
  made.extra = 1;
  describe("String reflected", made, String, OtherString.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("String reflected for itself", () => {
  const first = "text";
  const made = Reflect.construct(String, [first]);
  describe("String reflected for itself", made, String, String.prototype, first);
});

class BelowDate extends Date {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherDate() {}
OtherDate.prototype.mark = "Date";
attempt("Date new", () => {
  const first = 0;
  const made = new Date(first);
  made.extra = 1;
  describe("Date new", made, Date, Date.prototype, first);
  console.log(made.extra);
});
attempt("Date super", () => {
  const first = 0;
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowDate(first, i);
    sum += made.own();
  }
  describe("Date super", made, Date, BelowDate.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowDate);
});
attempt("Date reflected", () => {
  const first = 0;
  const made = Reflect.construct(Date, [first], OtherDate);
  made.extra = 1;
  describe("Date reflected", made, Date, OtherDate.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("Date reflected for itself", () => {
  const first = 0;
  const made = Reflect.construct(Date, [first]);
  describe("Date reflected for itself", made, Date, Date.prototype, first);
});

class BelowDateOfDate extends Date {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherDateOfDate() {}
OtherDateOfDate.prototype.mark = "DateOfDate";
attempt("DateOfDate new", () => {
  const first = new Date(5);
  const made = new Date(first);
  made.extra = 1;
  describe("DateOfDate new", made, Date, Date.prototype, first);
  console.log(made.extra);
});
attempt("DateOfDate super", () => {
  const first = new Date(5);
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowDateOfDate(first, i);
    sum += made.own();
  }
  describe("DateOfDate super", made, Date, BelowDateOfDate.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowDateOfDate);
});
attempt("DateOfDate reflected", () => {
  const first = new Date(5);
  const made = Reflect.construct(Date, [first], OtherDateOfDate);
  made.extra = 1;
  describe("DateOfDate reflected", made, Date, OtherDateOfDate.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("DateOfDate reflected for itself", () => {
  const first = new Date(5);
  const made = Reflect.construct(Date, [first]);
  describe("DateOfDate reflected for itself", made, Date, Date.prototype, first);
});

class BelowRegExp extends RegExp {
  tag;
  constructor(first, second, tag) {
    super(first, second);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherRegExp() {}
OtherRegExp.prototype.mark = "RegExp";
attempt("RegExp new", () => {
  const first = "a";
  const second = "g";
  const made = new RegExp(first, second);
  made.extra = 1;
  describe("RegExp new", made, RegExp, RegExp.prototype, first);
  console.log(made.extra);
});
attempt("RegExp super", () => {
  const first = "a";
  const second = "g";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowRegExp(first, second, i);
    sum += made.own();
  }
  describe("RegExp super", made, RegExp, BelowRegExp.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowRegExp);
});
attempt("RegExp reflected", () => {
  const first = "a";
  const second = "g";
  const made = Reflect.construct(RegExp, [first, second], OtherRegExp);
  made.extra = 1;
  describe("RegExp reflected", made, RegExp, OtherRegExp.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("RegExp reflected for itself", () => {
  const first = "a";
  const second = "g";
  const made = Reflect.construct(RegExp, [first, second]);
  describe("RegExp reflected for itself", made, RegExp, RegExp.prototype, first);
});

class BelowRegExpOfRegExp extends RegExp {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherRegExpOfRegExp() {}
OtherRegExpOfRegExp.prototype.mark = "RegExpOfRegExp";
attempt("RegExpOfRegExp new", () => {
  const first = /a/g;
  const made = new RegExp(first);
  made.extra = 1;
  describe("RegExpOfRegExp new", made, RegExp, RegExp.prototype, first);
  console.log(made.extra);
});
attempt("RegExpOfRegExp super", () => {
  const first = /a/g;
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowRegExpOfRegExp(first, i);
    sum += made.own();
  }
  describe("RegExpOfRegExp super", made, RegExp, BelowRegExpOfRegExp.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowRegExpOfRegExp);
});
attempt("RegExpOfRegExp reflected", () => {
  const first = /a/g;
  const made = Reflect.construct(RegExp, [first], OtherRegExpOfRegExp);
  made.extra = 1;
  describe("RegExpOfRegExp reflected", made, RegExp, OtherRegExpOfRegExp.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("RegExpOfRegExp reflected for itself", () => {
  const first = /a/g;
  const made = Reflect.construct(RegExp, [first]);
  describe("RegExpOfRegExp reflected for itself", made, RegExp, RegExp.prototype, first);
});

class BelowError extends Error {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherError() {}
OtherError.prototype.mark = "Error";
attempt("Error new", () => {
  const first = "message";
  const made = new Error(first);
  made.extra = 1;
  describe("Error new", made, Error, Error.prototype, first);
  console.log(made.extra);
});
attempt("Error super", () => {
  const first = "message";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowError(first, i);
    sum += made.own();
  }
  describe("Error super", made, Error, BelowError.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowError);
});
attempt("Error reflected", () => {
  const first = "message";
  const made = Reflect.construct(Error, [first], OtherError);
  made.extra = 1;
  describe("Error reflected", made, Error, OtherError.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("Error reflected for itself", () => {
  const first = "message";
  const made = Reflect.construct(Error, [first]);
  describe("Error reflected for itself", made, Error, Error.prototype, first);
});

class BelowTypeError extends TypeError {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherTypeError() {}
OtherTypeError.prototype.mark = "TypeError";
attempt("TypeError new", () => {
  const first = "message";
  const made = new TypeError(first);
  made.extra = 1;
  describe("TypeError new", made, TypeError, TypeError.prototype, first);
  console.log(made.extra);
});
attempt("TypeError super", () => {
  const first = "message";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowTypeError(first, i);
    sum += made.own();
  }
  describe("TypeError super", made, TypeError, BelowTypeError.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowTypeError);
});
attempt("TypeError reflected", () => {
  const first = "message";
  const made = Reflect.construct(TypeError, [first], OtherTypeError);
  made.extra = 1;
  describe("TypeError reflected", made, TypeError, OtherTypeError.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("TypeError reflected for itself", () => {
  const first = "message";
  const made = Reflect.construct(TypeError, [first]);
  describe("TypeError reflected for itself", made, TypeError, TypeError.prototype, first);
});

class BelowRangeError extends RangeError {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherRangeError() {}
OtherRangeError.prototype.mark = "RangeError";
attempt("RangeError new", () => {
  const first = "message";
  const made = new RangeError(first);
  made.extra = 1;
  describe("RangeError new", made, RangeError, RangeError.prototype, first);
  console.log(made.extra);
});
attempt("RangeError super", () => {
  const first = "message";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowRangeError(first, i);
    sum += made.own();
  }
  describe("RangeError super", made, RangeError, BelowRangeError.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowRangeError);
});
attempt("RangeError reflected", () => {
  const first = "message";
  const made = Reflect.construct(RangeError, [first], OtherRangeError);
  made.extra = 1;
  describe("RangeError reflected", made, RangeError, OtherRangeError.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("RangeError reflected for itself", () => {
  const first = "message";
  const made = Reflect.construct(RangeError, [first]);
  describe("RangeError reflected for itself", made, RangeError, RangeError.prototype, first);
});

class BelowAggregateError extends AggregateError {
  tag;
  constructor(first, second, tag) {
    super(first, second);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherAggregateError() {}
OtherAggregateError.prototype.mark = "AggregateError";
attempt("AggregateError new", () => {
  const first = [new Error('inner')];
  const second = "message";
  const made = new AggregateError(first, second);
  made.extra = 1;
  describe("AggregateError new", made, AggregateError, AggregateError.prototype, first);
  console.log(made.extra);
});
attempt("AggregateError super", () => {
  const first = [new Error('inner')];
  const second = "message";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowAggregateError(first, second, i);
    sum += made.own();
  }
  describe("AggregateError super", made, AggregateError, BelowAggregateError.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowAggregateError);
});
attempt("AggregateError reflected", () => {
  const first = [new Error('inner')];
  const second = "message";
  const made = Reflect.construct(AggregateError, [first, second], OtherAggregateError);
  made.extra = 1;
  describe("AggregateError reflected", made, AggregateError, OtherAggregateError.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("AggregateError reflected for itself", () => {
  const first = [new Error('inner')];
  const second = "message";
  const made = Reflect.construct(AggregateError, [first, second]);
  describe("AggregateError reflected for itself", made, AggregateError, AggregateError.prototype, first);
});

class BelowSuppressedError extends SuppressedError {
  tag;
  constructor(first, second, third, tag) {
    super(first, second, third);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherSuppressedError() {}
OtherSuppressedError.prototype.mark = "SuppressedError";
attempt("SuppressedError new", () => {
  const first = 1;
  const second = 2;
  const third = "message";
  const made = new SuppressedError(first, second, third);
  made.extra = 1;
  describe("SuppressedError new", made, SuppressedError, SuppressedError.prototype, first);
  console.log(made.extra);
});
attempt("SuppressedError super", () => {
  const first = 1;
  const second = 2;
  const third = "message";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowSuppressedError(first, second, third, i);
    sum += made.own();
  }
  describe("SuppressedError super", made, SuppressedError, BelowSuppressedError.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowSuppressedError);
});
attempt("SuppressedError reflected", () => {
  const first = 1;
  const second = 2;
  const third = "message";
  const made = Reflect.construct(SuppressedError, [first, second, third], OtherSuppressedError);
  made.extra = 1;
  describe("SuppressedError reflected", made, SuppressedError, OtherSuppressedError.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("SuppressedError reflected for itself", () => {
  const first = 1;
  const second = 2;
  const third = "message";
  const made = Reflect.construct(SuppressedError, [first, second, third]);
  describe("SuppressedError reflected for itself", made, SuppressedError, SuppressedError.prototype, first);
});

class BelowMap extends Map {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherMap() {}
OtherMap.prototype.mark = "Map";
attempt("Map new", () => {
  const first = [[1, 2]];
  const made = new Map(first);
  made.extra = 1;
  describe("Map new", made, Map, Map.prototype, first);
  console.log(made.extra);
});
attempt("Map super", () => {
  const first = [[1, 2]];
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowMap(first, i);
    sum += made.own();
  }
  describe("Map super", made, Map, BelowMap.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowMap);
});
attempt("Map reflected", () => {
  const first = [[1, 2]];
  const made = Reflect.construct(Map, [first], OtherMap);
  made.extra = 1;
  describe("Map reflected", made, Map, OtherMap.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("Map reflected for itself", () => {
  const first = [[1, 2]];
  const made = Reflect.construct(Map, [first]);
  describe("Map reflected for itself", made, Map, Map.prototype, first);
});

class BelowSet extends Set {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherSet() {}
OtherSet.prototype.mark = "Set";
attempt("Set new", () => {
  const first = [1];
  const made = new Set(first);
  made.extra = 1;
  describe("Set new", made, Set, Set.prototype, first);
  console.log(made.extra);
});
attempt("Set super", () => {
  const first = [1];
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowSet(first, i);
    sum += made.own();
  }
  describe("Set super", made, Set, BelowSet.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowSet);
});
attempt("Set reflected", () => {
  const first = [1];
  const made = Reflect.construct(Set, [first], OtherSet);
  made.extra = 1;
  describe("Set reflected", made, Set, OtherSet.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("Set reflected for itself", () => {
  const first = [1];
  const made = Reflect.construct(Set, [first]);
  describe("Set reflected for itself", made, Set, Set.prototype, first);
});

class BelowWeakMap extends WeakMap {
  tag;
  constructor(tag) {
    super();
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherWeakMap() {}
OtherWeakMap.prototype.mark = "WeakMap";
attempt("WeakMap new", () => {
  const made = new WeakMap();
  made.extra = 1;
  describe("WeakMap new", made, WeakMap, WeakMap.prototype, undefined);
  console.log(made.extra);
});
attempt("WeakMap super", () => {
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowWeakMap(i);
    sum += made.own();
  }
  describe("WeakMap super", made, WeakMap, BelowWeakMap.prototype, undefined);
  console.log(sum, made.tag, made.late, made instanceof BelowWeakMap);
});
attempt("WeakMap reflected", () => {
  const made = Reflect.construct(WeakMap, [], OtherWeakMap);
  made.extra = 1;
  describe("WeakMap reflected", made, WeakMap, OtherWeakMap.prototype, undefined);
  console.log(made.mark, made.extra);
});
attempt("WeakMap reflected for itself", () => {
  const made = Reflect.construct(WeakMap, []);
  describe("WeakMap reflected for itself", made, WeakMap, WeakMap.prototype, undefined);
});

class BelowWeakSet extends WeakSet {
  tag;
  constructor(tag) {
    super();
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherWeakSet() {}
OtherWeakSet.prototype.mark = "WeakSet";
attempt("WeakSet new", () => {
  const made = new WeakSet();
  made.extra = 1;
  describe("WeakSet new", made, WeakSet, WeakSet.prototype, undefined);
  console.log(made.extra);
});
attempt("WeakSet super", () => {
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowWeakSet(i);
    sum += made.own();
  }
  describe("WeakSet super", made, WeakSet, BelowWeakSet.prototype, undefined);
  console.log(sum, made.tag, made.late, made instanceof BelowWeakSet);
});
attempt("WeakSet reflected", () => {
  const made = Reflect.construct(WeakSet, [], OtherWeakSet);
  made.extra = 1;
  describe("WeakSet reflected", made, WeakSet, OtherWeakSet.prototype, undefined);
  console.log(made.mark, made.extra);
});
attempt("WeakSet reflected for itself", () => {
  const made = Reflect.construct(WeakSet, []);
  describe("WeakSet reflected for itself", made, WeakSet, WeakSet.prototype, undefined);
});

class BelowWeakRef extends WeakRef {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherWeakRef() {}
OtherWeakRef.prototype.mark = "WeakRef";
attempt("WeakRef new", () => {
  const first = { held: true };
  const made = new WeakRef(first);
  made.extra = 1;
  describe("WeakRef new", made, WeakRef, WeakRef.prototype, first);
  console.log(made.extra);
});
attempt("WeakRef super", () => {
  const first = { held: true };
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowWeakRef(first, i);
    sum += made.own();
  }
  describe("WeakRef super", made, WeakRef, BelowWeakRef.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowWeakRef);
});
attempt("WeakRef reflected", () => {
  const first = { held: true };
  const made = Reflect.construct(WeakRef, [first], OtherWeakRef);
  made.extra = 1;
  describe("WeakRef reflected", made, WeakRef, OtherWeakRef.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("WeakRef reflected for itself", () => {
  const first = { held: true };
  const made = Reflect.construct(WeakRef, [first]);
  describe("WeakRef reflected for itself", made, WeakRef, WeakRef.prototype, first);
});

class BelowPromise extends Promise {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherPromise() {}
OtherPromise.prototype.mark = "Promise";
attempt("Promise new", () => {
  const first = resolve => resolve(1);
  const made = new Promise(first);
  made.extra = 1;
  describe("Promise new", made, Promise, Promise.prototype, first);
  console.log(made.extra);
});
attempt("Promise super", () => {
  const first = resolve => resolve(1);
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowPromise(first, i);
    sum += made.own();
  }
  describe("Promise super", made, Promise, BelowPromise.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowPromise);
});
attempt("Promise reflected", () => {
  const first = resolve => resolve(1);
  const made = Reflect.construct(Promise, [first], OtherPromise);
  made.extra = 1;
  describe("Promise reflected", made, Promise, OtherPromise.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("Promise reflected for itself", () => {
  const first = resolve => resolve(1);
  const made = Reflect.construct(Promise, [first]);
  describe("Promise reflected for itself", made, Promise, Promise.prototype, first);
});

class BelowDataView extends DataView {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherDataView() {}
OtherDataView.prototype.mark = "DataView";
attempt("DataView new", () => {
  const first = new ArrayBuffer(8);
  const made = new DataView(first);
  made.extra = 1;
  describe("DataView new", made, DataView, DataView.prototype, first);
  console.log(made.extra);
});
attempt("DataView super", () => {
  const first = new ArrayBuffer(8);
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowDataView(first, i);
    sum += made.own();
  }
  describe("DataView super", made, DataView, BelowDataView.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowDataView);
});
attempt("DataView reflected", () => {
  const first = new ArrayBuffer(8);
  const made = Reflect.construct(DataView, [first], OtherDataView);
  made.extra = 1;
  describe("DataView reflected", made, DataView, OtherDataView.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("DataView reflected for itself", () => {
  const first = new ArrayBuffer(8);
  const made = Reflect.construct(DataView, [first]);
  describe("DataView reflected for itself", made, DataView, DataView.prototype, first);
});

class BelowUint8Array extends Uint8Array {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherUint8Array() {}
OtherUint8Array.prototype.mark = "Uint8Array";
attempt("Uint8Array new", () => {
  const first = 4;
  const made = new Uint8Array(first);
  made.extra = 1;
  describe("Uint8Array new", made, Uint8Array, Uint8Array.prototype, first);
  console.log(made.extra);
});
attempt("Uint8Array super", () => {
  const first = 4;
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowUint8Array(first, i);
    sum += made.own();
  }
  describe("Uint8Array super", made, Uint8Array, BelowUint8Array.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowUint8Array);
});
attempt("Uint8Array reflected", () => {
  const first = 4;
  const made = Reflect.construct(Uint8Array, [first], OtherUint8Array);
  made.extra = 1;
  describe("Uint8Array reflected", made, Uint8Array, OtherUint8Array.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("Uint8Array reflected for itself", () => {
  const first = 4;
  const made = Reflect.construct(Uint8Array, [first]);
  describe("Uint8Array reflected for itself", made, Uint8Array, Uint8Array.prototype, first);
});

class BelowUint8ArrayOfTyped extends Uint8Array {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherUint8ArrayOfTyped() {}
OtherUint8ArrayOfTyped.prototype.mark = "Uint8ArrayOfTyped";
attempt("Uint8ArrayOfTyped new", () => {
  const first = new Uint8Array([1, 2]);
  const made = new Uint8Array(first);
  made.extra = 1;
  describe("Uint8ArrayOfTyped new", made, Uint8Array, Uint8Array.prototype, first);
  console.log(made.extra);
});
attempt("Uint8ArrayOfTyped super", () => {
  const first = new Uint8Array([1, 2]);
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowUint8ArrayOfTyped(first, i);
    sum += made.own();
  }
  describe("Uint8ArrayOfTyped super", made, Uint8Array, BelowUint8ArrayOfTyped.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowUint8ArrayOfTyped);
});
attempt("Uint8ArrayOfTyped reflected", () => {
  const first = new Uint8Array([1, 2]);
  const made = Reflect.construct(Uint8Array, [first], OtherUint8ArrayOfTyped);
  made.extra = 1;
  describe("Uint8ArrayOfTyped reflected", made, Uint8Array, OtherUint8ArrayOfTyped.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("Uint8ArrayOfTyped reflected for itself", () => {
  const first = new Uint8Array([1, 2]);
  const made = Reflect.construct(Uint8Array, [first]);
  describe("Uint8ArrayOfTyped reflected for itself", made, Uint8Array, Uint8Array.prototype, first);
});

class BelowUint8ArrayOfBuffer extends Uint8Array {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherUint8ArrayOfBuffer() {}
OtherUint8ArrayOfBuffer.prototype.mark = "Uint8ArrayOfBuffer";
attempt("Uint8ArrayOfBuffer new", () => {
  const first = new ArrayBuffer(8);
  const made = new Uint8Array(first);
  made.extra = 1;
  describe("Uint8ArrayOfBuffer new", made, Uint8Array, Uint8Array.prototype, first);
  console.log(made.extra);
});
attempt("Uint8ArrayOfBuffer super", () => {
  const first = new ArrayBuffer(8);
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowUint8ArrayOfBuffer(first, i);
    sum += made.own();
  }
  describe("Uint8ArrayOfBuffer super", made, Uint8Array, BelowUint8ArrayOfBuffer.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowUint8ArrayOfBuffer);
});
attempt("Uint8ArrayOfBuffer reflected", () => {
  const first = new ArrayBuffer(8);
  const made = Reflect.construct(Uint8Array, [first], OtherUint8ArrayOfBuffer);
  made.extra = 1;
  describe("Uint8ArrayOfBuffer reflected", made, Uint8Array, OtherUint8ArrayOfBuffer.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("Uint8ArrayOfBuffer reflected for itself", () => {
  const first = new ArrayBuffer(8);
  const made = Reflect.construct(Uint8Array, [first]);
  describe("Uint8ArrayOfBuffer reflected for itself", made, Uint8Array, Uint8Array.prototype, first);
});

class BelowUint8ArrayOfList extends Uint8Array {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherUint8ArrayOfList() {}
OtherUint8ArrayOfList.prototype.mark = "Uint8ArrayOfList";
attempt("Uint8ArrayOfList new", () => {
  const first = [1, 2, 3];
  const made = new Uint8Array(first);
  made.extra = 1;
  describe("Uint8ArrayOfList new", made, Uint8Array, Uint8Array.prototype, first);
  console.log(made.extra);
});
attempt("Uint8ArrayOfList super", () => {
  const first = [1, 2, 3];
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowUint8ArrayOfList(first, i);
    sum += made.own();
  }
  describe("Uint8ArrayOfList super", made, Uint8Array, BelowUint8ArrayOfList.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowUint8ArrayOfList);
});
attempt("Uint8ArrayOfList reflected", () => {
  const first = [1, 2, 3];
  const made = Reflect.construct(Uint8Array, [first], OtherUint8ArrayOfList);
  made.extra = 1;
  describe("Uint8ArrayOfList reflected", made, Uint8Array, OtherUint8ArrayOfList.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("Uint8ArrayOfList reflected for itself", () => {
  const first = [1, 2, 3];
  const made = Reflect.construct(Uint8Array, [first]);
  describe("Uint8ArrayOfList reflected for itself", made, Uint8Array, Uint8Array.prototype, first);
});

class BelowFloat64Array extends Float64Array {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherFloat64Array() {}
OtherFloat64Array.prototype.mark = "Float64Array";
attempt("Float64Array new", () => {
  const first = [1.5, 2.5];
  const made = new Float64Array(first);
  made.extra = 1;
  describe("Float64Array new", made, Float64Array, Float64Array.prototype, first);
  console.log(made.extra);
});
attempt("Float64Array super", () => {
  const first = [1.5, 2.5];
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowFloat64Array(first, i);
    sum += made.own();
  }
  describe("Float64Array super", made, Float64Array, BelowFloat64Array.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowFloat64Array);
});
attempt("Float64Array reflected", () => {
  const first = [1.5, 2.5];
  const made = Reflect.construct(Float64Array, [first], OtherFloat64Array);
  made.extra = 1;
  describe("Float64Array reflected", made, Float64Array, OtherFloat64Array.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("Float64Array reflected for itself", () => {
  const first = [1.5, 2.5];
  const made = Reflect.construct(Float64Array, [first]);
  describe("Float64Array reflected for itself", made, Float64Array, Float64Array.prototype, first);
});

class BelowBigInt64Array extends BigInt64Array {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherBigInt64Array() {}
OtherBigInt64Array.prototype.mark = "BigInt64Array";
attempt("BigInt64Array new", () => {
  const first = 2;
  const made = new BigInt64Array(first);
  made.extra = 1;
  describe("BigInt64Array new", made, BigInt64Array, BigInt64Array.prototype, first);
  console.log(made.extra);
});
attempt("BigInt64Array super", () => {
  const first = 2;
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowBigInt64Array(first, i);
    sum += made.own();
  }
  describe("BigInt64Array super", made, BigInt64Array, BelowBigInt64Array.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowBigInt64Array);
});
attempt("BigInt64Array reflected", () => {
  const first = 2;
  const made = Reflect.construct(BigInt64Array, [first], OtherBigInt64Array);
  made.extra = 1;
  describe("BigInt64Array reflected", made, BigInt64Array, OtherBigInt64Array.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("BigInt64Array reflected for itself", () => {
  const first = 2;
  const made = Reflect.construct(BigInt64Array, [first]);
  describe("BigInt64Array reflected for itself", made, BigInt64Array, BigInt64Array.prototype, first);
});

class BelowInt32Array extends Int32Array {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherInt32Array() {}
OtherInt32Array.prototype.mark = "Int32Array";
attempt("Int32Array new", () => {
  const first = 2;
  const made = new Int32Array(first);
  made.extra = 1;
  describe("Int32Array new", made, Int32Array, Int32Array.prototype, first);
  console.log(made.extra);
});
attempt("Int32Array super", () => {
  const first = 2;
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowInt32Array(first, i);
    sum += made.own();
  }
  describe("Int32Array super", made, Int32Array, BelowInt32Array.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowInt32Array);
});
attempt("Int32Array reflected", () => {
  const first = 2;
  const made = Reflect.construct(Int32Array, [first], OtherInt32Array);
  made.extra = 1;
  describe("Int32Array reflected", made, Int32Array, OtherInt32Array.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("Int32Array reflected for itself", () => {
  const first = 2;
  const made = Reflect.construct(Int32Array, [first]);
  describe("Int32Array reflected for itself", made, Int32Array, Int32Array.prototype, first);
});

class BelowFinalizationRegistry extends FinalizationRegistry {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherFinalizationRegistry() {}
OtherFinalizationRegistry.prototype.mark = "FinalizationRegistry";
attempt("FinalizationRegistry new", () => {
  const first = () => {};
  const made = new FinalizationRegistry(first);
  made.extra = 1;
  describe("FinalizationRegistry new", made, FinalizationRegistry, FinalizationRegistry.prototype, first);
  console.log(made.extra);
});
attempt("FinalizationRegistry super", () => {
  const first = () => {};
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowFinalizationRegistry(first, i);
    sum += made.own();
  }
  describe("FinalizationRegistry super", made, FinalizationRegistry, BelowFinalizationRegistry.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowFinalizationRegistry);
});
attempt("FinalizationRegistry reflected", () => {
  const first = () => {};
  const made = Reflect.construct(FinalizationRegistry, [first], OtherFinalizationRegistry);
  made.extra = 1;
  describe("FinalizationRegistry reflected", made, FinalizationRegistry, OtherFinalizationRegistry.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("FinalizationRegistry reflected for itself", () => {
  const first = () => {};
  const made = Reflect.construct(FinalizationRegistry, [first]);
  describe("FinalizationRegistry reflected for itself", made, FinalizationRegistry, FinalizationRegistry.prototype, first);
});

class BelowIterator extends Iterator {
  tag;
  constructor(tag) {
    super();
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherIterator() {}
OtherIterator.prototype.mark = "Iterator";
attempt("Iterator new", () => {
  const made = new Iterator();
  made.extra = 1;
  describe("Iterator new", made, Iterator, Iterator.prototype, undefined);
  console.log(made.extra);
});
attempt("Iterator super", () => {
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowIterator(i);
    sum += made.own();
  }
  describe("Iterator super", made, Iterator, BelowIterator.prototype, undefined);
  console.log(sum, made.tag, made.late, made instanceof BelowIterator);
});
attempt("Iterator reflected", () => {
  const made = Reflect.construct(Iterator, [], OtherIterator);
  made.extra = 1;
  describe("Iterator reflected", made, Iterator, OtherIterator.prototype, undefined);
  console.log(made.mark, made.extra);
});
attempt("Iterator reflected for itself", () => {
  const made = Reflect.construct(Iterator, []);
  describe("Iterator reflected for itself", made, Iterator, Iterator.prototype, undefined);
});

class BelowDisposableStack extends DisposableStack {
  tag;
  constructor(tag) {
    super();
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherDisposableStack() {}
OtherDisposableStack.prototype.mark = "DisposableStack";
attempt("DisposableStack new", () => {
  const made = new DisposableStack();
  made.extra = 1;
  describe("DisposableStack new", made, DisposableStack, DisposableStack.prototype, undefined);
  console.log(made.extra);
});
attempt("DisposableStack super", () => {
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowDisposableStack(i);
    sum += made.own();
  }
  describe("DisposableStack super", made, DisposableStack, BelowDisposableStack.prototype, undefined);
  console.log(sum, made.tag, made.late, made instanceof BelowDisposableStack);
});
attempt("DisposableStack reflected", () => {
  const made = Reflect.construct(DisposableStack, [], OtherDisposableStack);
  made.extra = 1;
  describe("DisposableStack reflected", made, DisposableStack, OtherDisposableStack.prototype, undefined);
  console.log(made.mark, made.extra);
});
attempt("DisposableStack reflected for itself", () => {
  const made = Reflect.construct(DisposableStack, []);
  describe("DisposableStack reflected for itself", made, DisposableStack, DisposableStack.prototype, undefined);
});

class BelowAsyncDisposableStack extends AsyncDisposableStack {
  tag;
  constructor(tag) {
    super();
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherAsyncDisposableStack() {}
OtherAsyncDisposableStack.prototype.mark = "AsyncDisposableStack";
attempt("AsyncDisposableStack new", () => {
  const made = new AsyncDisposableStack();
  made.extra = 1;
  describe("AsyncDisposableStack new", made, AsyncDisposableStack, AsyncDisposableStack.prototype, undefined);
  console.log(made.extra);
});
attempt("AsyncDisposableStack super", () => {
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowAsyncDisposableStack(i);
    sum += made.own();
  }
  describe("AsyncDisposableStack super", made, AsyncDisposableStack, BelowAsyncDisposableStack.prototype, undefined);
  console.log(sum, made.tag, made.late, made instanceof BelowAsyncDisposableStack);
});
attempt("AsyncDisposableStack reflected", () => {
  const made = Reflect.construct(AsyncDisposableStack, [], OtherAsyncDisposableStack);
  made.extra = 1;
  describe("AsyncDisposableStack reflected", made, AsyncDisposableStack, OtherAsyncDisposableStack.prototype, undefined);
  console.log(made.mark, made.extra);
});
attempt("AsyncDisposableStack reflected for itself", () => {
  const made = Reflect.construct(AsyncDisposableStack, []);
  describe("AsyncDisposableStack reflected for itself", made, AsyncDisposableStack, AsyncDisposableStack.prototype, undefined);
});

class BelowFunction extends Function {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherFunction() {}
OtherFunction.prototype.mark = "Function";
attempt("Function new", () => {
  const first = "return 1";
  const made = new Function(first);
  made.extra = 1;
  describe("Function new", made, Function, Function.prototype, first);
  console.log(made.extra);
});
attempt("Function super", () => {
  const first = "return 1";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowFunction(first, i);
    sum += made.own();
  }
  describe("Function super", made, Function, BelowFunction.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowFunction);
});
attempt("Function reflected", () => {
  const first = "return 1";
  const made = Reflect.construct(Function, [first], OtherFunction);
  made.extra = 1;
  describe("Function reflected", made, Function, OtherFunction.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("Function reflected for itself", () => {
  const first = "return 1";
  const made = Reflect.construct(Function, [first]);
  describe("Function reflected for itself", made, Function, Function.prototype, first);
});

class BelowIntlNumberFormat extends Intl.NumberFormat {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherIntlNumberFormat() {}
OtherIntlNumberFormat.prototype.mark = "IntlNumberFormat";
attempt("IntlNumberFormat new", () => {
  const first = "en";
  const made = new Intl.NumberFormat(first);
  made.extra = 1;
  describe("IntlNumberFormat new", made, Intl.NumberFormat, Intl.NumberFormat.prototype, first);
  console.log(made.extra);
});
attempt("IntlNumberFormat super", () => {
  const first = "en";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowIntlNumberFormat(first, i);
    sum += made.own();
  }
  describe("IntlNumberFormat super", made, Intl.NumberFormat, BelowIntlNumberFormat.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowIntlNumberFormat);
});
attempt("IntlNumberFormat reflected", () => {
  const first = "en";
  const made = Reflect.construct(Intl.NumberFormat, [first], OtherIntlNumberFormat);
  made.extra = 1;
  describe("IntlNumberFormat reflected", made, Intl.NumberFormat, OtherIntlNumberFormat.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("IntlNumberFormat reflected for itself", () => {
  const first = "en";
  const made = Reflect.construct(Intl.NumberFormat, [first]);
  describe("IntlNumberFormat reflected for itself", made, Intl.NumberFormat, Intl.NumberFormat.prototype, first);
});

class BelowIntlDateTimeFormat extends Intl.DateTimeFormat {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherIntlDateTimeFormat() {}
OtherIntlDateTimeFormat.prototype.mark = "IntlDateTimeFormat";
attempt("IntlDateTimeFormat new", () => {
  const first = "en";
  const made = new Intl.DateTimeFormat(first);
  made.extra = 1;
  describe("IntlDateTimeFormat new", made, Intl.DateTimeFormat, Intl.DateTimeFormat.prototype, first);
  console.log(made.extra);
});
attempt("IntlDateTimeFormat super", () => {
  const first = "en";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowIntlDateTimeFormat(first, i);
    sum += made.own();
  }
  describe("IntlDateTimeFormat super", made, Intl.DateTimeFormat, BelowIntlDateTimeFormat.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowIntlDateTimeFormat);
});
attempt("IntlDateTimeFormat reflected", () => {
  const first = "en";
  const made = Reflect.construct(Intl.DateTimeFormat, [first], OtherIntlDateTimeFormat);
  made.extra = 1;
  describe("IntlDateTimeFormat reflected", made, Intl.DateTimeFormat, OtherIntlDateTimeFormat.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("IntlDateTimeFormat reflected for itself", () => {
  const first = "en";
  const made = Reflect.construct(Intl.DateTimeFormat, [first]);
  describe("IntlDateTimeFormat reflected for itself", made, Intl.DateTimeFormat, Intl.DateTimeFormat.prototype, first);
});

class BelowIntlCollator extends Intl.Collator {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherIntlCollator() {}
OtherIntlCollator.prototype.mark = "IntlCollator";
attempt("IntlCollator new", () => {
  const first = "en";
  const made = new Intl.Collator(first);
  made.extra = 1;
  describe("IntlCollator new", made, Intl.Collator, Intl.Collator.prototype, first);
  console.log(made.extra);
});
attempt("IntlCollator super", () => {
  const first = "en";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowIntlCollator(first, i);
    sum += made.own();
  }
  describe("IntlCollator super", made, Intl.Collator, BelowIntlCollator.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowIntlCollator);
});
attempt("IntlCollator reflected", () => {
  const first = "en";
  const made = Reflect.construct(Intl.Collator, [first], OtherIntlCollator);
  made.extra = 1;
  describe("IntlCollator reflected", made, Intl.Collator, OtherIntlCollator.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("IntlCollator reflected for itself", () => {
  const first = "en";
  const made = Reflect.construct(Intl.Collator, [first]);
  describe("IntlCollator reflected for itself", made, Intl.Collator, Intl.Collator.prototype, first);
});

class BelowIntlPluralRules extends Intl.PluralRules {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherIntlPluralRules() {}
OtherIntlPluralRules.prototype.mark = "IntlPluralRules";
attempt("IntlPluralRules new", () => {
  const first = "en";
  const made = new Intl.PluralRules(first);
  made.extra = 1;
  describe("IntlPluralRules new", made, Intl.PluralRules, Intl.PluralRules.prototype, first);
  console.log(made.extra);
});
attempt("IntlPluralRules super", () => {
  const first = "en";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowIntlPluralRules(first, i);
    sum += made.own();
  }
  describe("IntlPluralRules super", made, Intl.PluralRules, BelowIntlPluralRules.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowIntlPluralRules);
});
attempt("IntlPluralRules reflected", () => {
  const first = "en";
  const made = Reflect.construct(Intl.PluralRules, [first], OtherIntlPluralRules);
  made.extra = 1;
  describe("IntlPluralRules reflected", made, Intl.PluralRules, OtherIntlPluralRules.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("IntlPluralRules reflected for itself", () => {
  const first = "en";
  const made = Reflect.construct(Intl.PluralRules, [first]);
  describe("IntlPluralRules reflected for itself", made, Intl.PluralRules, Intl.PluralRules.prototype, first);
});

class BelowIntlListFormat extends Intl.ListFormat {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherIntlListFormat() {}
OtherIntlListFormat.prototype.mark = "IntlListFormat";
attempt("IntlListFormat new", () => {
  const first = "en";
  const made = new Intl.ListFormat(first);
  made.extra = 1;
  describe("IntlListFormat new", made, Intl.ListFormat, Intl.ListFormat.prototype, first);
  console.log(made.extra);
});
attempt("IntlListFormat super", () => {
  const first = "en";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowIntlListFormat(first, i);
    sum += made.own();
  }
  describe("IntlListFormat super", made, Intl.ListFormat, BelowIntlListFormat.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowIntlListFormat);
});
attempt("IntlListFormat reflected", () => {
  const first = "en";
  const made = Reflect.construct(Intl.ListFormat, [first], OtherIntlListFormat);
  made.extra = 1;
  describe("IntlListFormat reflected", made, Intl.ListFormat, OtherIntlListFormat.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("IntlListFormat reflected for itself", () => {
  const first = "en";
  const made = Reflect.construct(Intl.ListFormat, [first]);
  describe("IntlListFormat reflected for itself", made, Intl.ListFormat, Intl.ListFormat.prototype, first);
});

class BelowIntlLocale extends Intl.Locale {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherIntlLocale() {}
OtherIntlLocale.prototype.mark = "IntlLocale";
attempt("IntlLocale new", () => {
  const first = "en";
  const made = new Intl.Locale(first);
  made.extra = 1;
  describe("IntlLocale new", made, Intl.Locale, Intl.Locale.prototype, first);
  console.log(made.extra);
});
attempt("IntlLocale super", () => {
  const first = "en";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowIntlLocale(first, i);
    sum += made.own();
  }
  describe("IntlLocale super", made, Intl.Locale, BelowIntlLocale.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowIntlLocale);
});
attempt("IntlLocale reflected", () => {
  const first = "en";
  const made = Reflect.construct(Intl.Locale, [first], OtherIntlLocale);
  made.extra = 1;
  describe("IntlLocale reflected", made, Intl.Locale, OtherIntlLocale.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("IntlLocale reflected for itself", () => {
  const first = "en";
  const made = Reflect.construct(Intl.Locale, [first]);
  describe("IntlLocale reflected for itself", made, Intl.Locale, Intl.Locale.prototype, first);
});

class BelowIntlSegmenter extends Intl.Segmenter {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherIntlSegmenter() {}
OtherIntlSegmenter.prototype.mark = "IntlSegmenter";
attempt("IntlSegmenter new", () => {
  const first = "en";
  const made = new Intl.Segmenter(first);
  made.extra = 1;
  describe("IntlSegmenter new", made, Intl.Segmenter, Intl.Segmenter.prototype, first);
  console.log(made.extra);
});
attempt("IntlSegmenter super", () => {
  const first = "en";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowIntlSegmenter(first, i);
    sum += made.own();
  }
  describe("IntlSegmenter super", made, Intl.Segmenter, BelowIntlSegmenter.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowIntlSegmenter);
});
attempt("IntlSegmenter reflected", () => {
  const first = "en";
  const made = Reflect.construct(Intl.Segmenter, [first], OtherIntlSegmenter);
  made.extra = 1;
  describe("IntlSegmenter reflected", made, Intl.Segmenter, OtherIntlSegmenter.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("IntlSegmenter reflected for itself", () => {
  const first = "en";
  const made = Reflect.construct(Intl.Segmenter, [first]);
  describe("IntlSegmenter reflected for itself", made, Intl.Segmenter, Intl.Segmenter.prototype, first);
});

class BelowIntlRelativeTimeFormat extends Intl.RelativeTimeFormat {
  tag;
  constructor(first, tag) {
    super(first);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherIntlRelativeTimeFormat() {}
OtherIntlRelativeTimeFormat.prototype.mark = "IntlRelativeTimeFormat";
attempt("IntlRelativeTimeFormat new", () => {
  const first = "en";
  const made = new Intl.RelativeTimeFormat(first);
  made.extra = 1;
  describe("IntlRelativeTimeFormat new", made, Intl.RelativeTimeFormat, Intl.RelativeTimeFormat.prototype, first);
  console.log(made.extra);
});
attempt("IntlRelativeTimeFormat super", () => {
  const first = "en";
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowIntlRelativeTimeFormat(first, i);
    sum += made.own();
  }
  describe("IntlRelativeTimeFormat super", made, Intl.RelativeTimeFormat, BelowIntlRelativeTimeFormat.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowIntlRelativeTimeFormat);
});
attempt("IntlRelativeTimeFormat reflected", () => {
  const first = "en";
  const made = Reflect.construct(Intl.RelativeTimeFormat, [first], OtherIntlRelativeTimeFormat);
  made.extra = 1;
  describe("IntlRelativeTimeFormat reflected", made, Intl.RelativeTimeFormat, OtherIntlRelativeTimeFormat.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("IntlRelativeTimeFormat reflected for itself", () => {
  const first = "en";
  const made = Reflect.construct(Intl.RelativeTimeFormat, [first]);
  describe("IntlRelativeTimeFormat reflected for itself", made, Intl.RelativeTimeFormat, Intl.RelativeTimeFormat.prototype, first);
});

class BelowIntlDisplayNames extends Intl.DisplayNames {
  tag;
  constructor(first, second, tag) {
    super(first, second);
    this.tag = tag;
    this.late = "late";
  }
  own() { return this.tag; }
}
function OtherIntlDisplayNames() {}
OtherIntlDisplayNames.prototype.mark = "IntlDisplayNames";
attempt("IntlDisplayNames new", () => {
  const first = "en";
  const second = { type: "region" };
  const made = new Intl.DisplayNames(first, second);
  made.extra = 1;
  describe("IntlDisplayNames new", made, Intl.DisplayNames, Intl.DisplayNames.prototype, first);
  console.log(made.extra);
});
attempt("IntlDisplayNames super", () => {
  const first = "en";
  const second = { type: "region" };
  let sum = 0;
  let made;
  for (let i = 0; i < 40; i++) {
    made = new BelowIntlDisplayNames(first, second, i);
    sum += made.own();
  }
  describe("IntlDisplayNames super", made, Intl.DisplayNames, BelowIntlDisplayNames.prototype, first);
  console.log(sum, made.tag, made.late, made instanceof BelowIntlDisplayNames);
});
attempt("IntlDisplayNames reflected", () => {
  const first = "en";
  const second = { type: "region" };
  const made = Reflect.construct(Intl.DisplayNames, [first, second], OtherIntlDisplayNames);
  made.extra = 1;
  describe("IntlDisplayNames reflected", made, Intl.DisplayNames, OtherIntlDisplayNames.prototype, first);
  console.log(made.mark, made.extra);
});
attempt("IntlDisplayNames reflected for itself", () => {
  const first = "en";
  const second = { type: "region" };
  const made = Reflect.construct(Intl.DisplayNames, [first, second]);
  describe("IntlDisplayNames reflected for itself", made, Intl.DisplayNames, Intl.DisplayNames.prototype, first);
});
