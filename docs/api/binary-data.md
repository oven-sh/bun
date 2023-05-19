This page is intended as an introduction to working with binary data in JavaScript. Bun implements a number of data types and utilities for working with binary data, most of which are Web-standard. Any Bun-specific APIs will be noted as such.

## `ArrayBuffer`

Until 2009, there was no language-native way to store and manipulate binary data in JavaScript. ECMAScript v5 introduced an _array_ of classes for doing so.

The most primitive and low-level construct for dealing with binary data is the `ArrayBuffer`. Think of it as a sequence of bytes. Despite the name, it isn't an array and supports none of the array methods and operators one might expect.

```ts
// this buffer can store 10 bytes
const buf = new ArrayBuffer(10);
```

Perhaps unexpectedly, there's no can't read from or write to an `ArrayBuffer`. In fact, there's very little you can do with one except check its size and create "slices" from it.

```ts
const buf = new ArrayBuffer(10);

buf.byteLength; // => 10

const slice = buf.slice(0, 5); // returns new ArrayBuffer
slice.byteLength; // => 5
```

To do anything interesting we need a construct known as a "view". A view is a class that _wraps_ an `ArrayBuffer` instance and lets us read and manipulate the underlying data. There are two types of views: typed arrays and `DataView`.

## Typed arrays

Typed arrays are a family of classes that provide an `Array`-like interface for interacting with data in an `ArrayBuffer`.

```ts
const buffer = new ArrayBuffer(3);
const arr = new Uint8Array(buffer);

// contents are initialized to zero
console.log(arr); // Uint8Array(3) [0, 0, 0]

// assign values like an array
arr[0] = 0;
arr[1] = 10;
arr[2] = 255;
arr[3] = 255; // no-op, out of bounds

// supports common array methods
// filter, map, reduce, each, every, find, includes, indexOf
const newarr = arr.filter(n => n > 128); // Uint8Array(1) [255]
```

{% callout %}
Commonly, you will see this family of classes referred to collectively by their shared superclass `TypedArray`. This class as _internal_ to JavaScript; you can't directly create instances of it, and `TypedArray` is not defined in the global scope. Think of it as an `interface` or an abstract class.
{% /callout %}

While an `ArrayBuffer` is a generic sequence of bytes, these typed array classes interpret the bytes as a sequence of numbers of different sizes. The top row contains the raw bytes, and the later rows contain how these bytes will be interpreted when _viewed_ using different typed array classes.

The following classes are typed arrays, along with a description of how they interpret the bytes in an `ArrayBuffer`:

{% table %}

- Class
- Description

---

- [`Uint8Array`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array)
- Every one (1) byte is interpreted as an unsigned 8-bit integer. Range 0 to 255.

---

- [`Uint16Array`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint16Array)
- Every two (2) bytes are interpreted as an unsigned 16-bit integer. Range 0 to 65535.

---

- [`Uint32Array`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint32Array)
- Every four (4) bytes are interpreted as an unsigned 32-bit integer. Range 0 to 4294967295.

---

- [`Int8Array`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Int8Array)
- Every one (1) byte is interpreted as a signed 8-bit integer. Range -128 to 127.

---

- [`Int16Array`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Int16Array)
- Every two (2) bytes are interpreted as a signed 16-bit integer. Range -32768 to 32767.

---

- [`Int32Array`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Int32Array)
- Every four (4) bytes are interpreted as a signed 32-bit integer. Range -2147483648 to 2147483647.

---

- [`Float32Array`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Float32Array)
- Every four (4) bytes are interpreted as a 32-bit floating point number. Range -3.4e38 to 3.4e38.

---

- [`Float64Array`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Float64Array)
- Every eight (8) bytes are interpreted as a 64-bit floating point number. Range -1.7e308 to 1.7e308.

---

- [`BigInt64Array`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt64Array)
- Every eight (8) bytes are interpreted as an unsigned `BigInt`. Range -9223372036854775808 to 9223372036854775807 (though `BigInt` is capable of representing larger numbers).

---

- [`BigUint64Array`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigUint64Array)
- Every eight (8) bytes are interpreted as an unsigned `BigInt`. Range 0 to 18446744073709551615 (though `BigInt` is capable of representing larger numbers).

---

- [`Uint8ClampedArray`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8ClampedArray)
- Same as `Uint8Array`, but automatically "clamps" to the range 0-255 when assigning a value to an element.

{% /table %}

The table below demonstrates how the bytes in an `ArrayBuffer` are interpreted when viewed using different typed array classes.

{% table %}

---

- `ArrayBuffer`
- `00000000`
- `00000001`
- `00000010`
- `00000011`
- `00000100`
- `00000101`
- `00000110`
- `00000111`

---

- `Uint8Array`
- 0
- 1
- 2
- 3
- 4
- 5
- 6
- 7

---

- `Uint16Array`
- 256 (`1 * 256 + 0`) {% colspan=2 %}
- 770 (`3 * 256 + 2`) {% colspan=2 %}
- 1284 (`5 * 256 + 4`) {% colspan=2 %}
- 1798 (`7 * 256 + 6`) {% colspan=2 %}

---

- `Uint32Array`
- 50462976 {% colspan=4 %}
- 117835012 {% colspan=4 %}

---

- `BigUint64Array`
- 506097522914230528n {% colspan=8 %}

{% /table %}

### Creating typed arrays

{% callout %}

In the examples below, we'll be creating instances of `Uint8Array`, as it's simple and commonly used. Each individual byte of the `ArrayBuffer` is interpreted as a number between 0 and 255.

{% /callout %}

To create a typed array from a pre-defined `ArrayBuffer`:

```ts
// create typed array from ArrayBuffer
const buf = new ArrayBuffer(3);
const arr = new Uint8Array(buf);

arr[0] = 30;
arr[1] = 60;
console.log(arr); // => Uint8Array(3) [ 30, 60, 0 ];
```

You can also create a typed array from a particular "slice" of an `ArrayBuffer`.

```ts
// create typed array from ArrayBuffer slice
const buf = new ArrayBuffer(10);

// [0, ]

// 5 = offset
// 10 = length
const arr = new Uint8Array(buf, 5, 3);
```

In most cases, though, you won't explicitly create an `ArrayBuffer` instance. You can instantiate typed arrays from a dataTo create a typed array from an array of numbers:

```ts
const arr = new Uint8Array([30, 60, 90]);
arr[0]; // => 30;
```

- Use Buffer
- TextEncoder
- `Bun.ArrayBufferSink`
- ReadableStream
- AsyncIterator
- TypedArray vs ArrayBuffer vs DataView
- Bun.indexOfLine
- “direct” readablestream
  - readable stream has assumptions about
  - its very generic
  - all data is copies and queued
  - direct : no queueing
  - just a write function
  - you can write strings
  - more synchronous
  - corking works better
