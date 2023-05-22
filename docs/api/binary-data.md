This page is intended as an introduction to working with binary data in JavaScript. Bun implements a number of data types and utilities for working with binary data, most of which are Web-standard. Any Bun-specific APIs will be noted as such.

## `ArrayBuffer`

Until 2009, there was no language-native way to store and manipulate binary data in JavaScript. ECMAScript v5 introduced a range of new mechanisms for this.

In JavaScript, The data structure that underlies all binary data manipulation is the `ArrayBuffer`. Think of it as a simple sequence of bytes stored somewhere in memory.

```ts
// this buffer can store 8 bytes
const buf = new ArrayBuffer(8);
```

Despite the name, it isn't an array and supports none of the array methods and operators one might expect. In fact, there is no way to directly read or write values from an `ArrayBuffer`. There's very little you can do with one except check its size and create "slices" from it.

```ts
const buf = new ArrayBuffer(8);

buf.byteLength; // => 8

const slice = buf.slice(0, 4); // returns new ArrayBuffer
slice.byteLength; // => 4
```

To do anything interesting we need a construct known as a "view". A view is a class that _wraps_ an `ArrayBuffer` instance and lets you read and manipulate the underlying data. There are two types of views: _typed arrays_ and `DataView`.

## Typed arrays

Typed arrays are a family of classes that provide an `Array`-like interface for interacting with data in an `ArrayBuffer`.

{% callout %}
Commonly, you will see this family of classes referred to collectively by their shared superclass `TypedArray`. This class as _internal_ to JavaScript; you can't directly create instances of it, and `TypedArray` is not defined in the global scope. Think of it as an `interface` or an abstract class.
{% /callout %}

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

To create a typed array from a pre-defined `ArrayBuffer`:

```ts
// create typed array from ArrayBuffer
const buf = new ArrayBuffer(10);
const arr = new Uint8Array(buf);

arr[0] = 30;
arr[1] = 60;
console.log(arr); // => Uint8Array(3) [ 30, 60, 0, 0, 0, 0, 0, 0, 0, 0 ];
```

If we tried to instantiate a `Uint32Array` from this same `ArrayBuffer`, we'd get an error.

```ts
const buf = new ArrayBuffer(10);
const arr = new Uint32Array(buf);
//          ^  RangeError: ArrayBuffer length minus the byteOffset
//             is not a multiple of the element size
```

A `Uint32` value requires four bytes (16 bits). Because the `ArrayBuffer` is 10 bytes long, there's no way to cleanly divide its contents into 4-byte chunks.

To fix this, we can create a typed array over a particular "slice" of an `ArrayBuffer`. The `Uint16Array` below only "views" the _first_ 8 bytes of the underlying `ArrayBuffer`. To achieve these, we specify a `byteOffset` of `0` and a `length` of `2`, which indicates the number of `Uint32` numbers we want our array to hold.

```ts
// create typed array from ArrayBuffer slice
const buf = new ArrayBuffer(10);
const arr = new Uint32Array(buf, 0, 2);

/*
  buf    _ _ _ _ _ _ _ _ _ _    10 bytes
  arr   [_______,_______]       2 4-byte elements
*/

arr.byteOffset; // 0
arr.length; // 2
```

You don't need to explicitly create an `ArrayBuffer` instance; you can instead directly specify a length in the typed array constructor:

```ts
const arr2 = new Uint8Array(5);

// all elements are initialized to zero
// => Uint8Array(5) [0, 0, 0, 0, 0]
```

Typed arrays can also be instantiated directly from an array of numbers, or another typed array:

```ts
// from an array of numbers
const arr1 = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
arr1[0]; // => 0;
arr1[7]; // => 7;

// from another typed array
const arr2 = new Uint8Array(arr);
```

Refer to the [MDN documentation](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypedArray) for more information on the properties and methods of typed arrays.

## `DataView`

The `DataView` class is a lower-level interface for reading and manipulating binary data. Whereas typed arrays interpret the underlying bytes as an array of numbers with a consistent number of bytes per element, `DataView` provides granular methods for reading and writing binary data at a given byte offset.

Below we create a new `DataView` and set the first byte to 5.

```ts
const buf = new ArrayBuffer(4);
// [0x0, 0x0, 0x0]

const dv = new DataView(buf);
dv.setUint8(0, 3); // write value 3 at byte offset 0
dv.getUint8(0); // => 3
// [0x11, 0x0, 0x0, 0x0]
```

Now lets write a `Uint16` at byte offset `1`. This requires two bytes. We're using the value `513`, which is `2 * 256 + 1`; in bytes, that's `00000010 00000001`.

```ts
dv.setUint16(1, 513);
// [0x11, 0x10, 0x1, 0x0]

console.log(dv.getUint16(1)); // => 513
```

We've now assigned a value to the first three bytes in our underlying `ArrayBuffer`. Even though the second and third bytes were created using `setUint16()`, we can still read each of its component bytes using `getUint8()`.

```ts
console.log(dv.getUint8(1)); // => 2
console.log(dv.getUint8(2)); // => 1
```

Attempting to write a value that requires more space than is available in the underlying `ArrayBuffer` will cuase an error. Below we attempt to write a `Float64` (which requires 8 bytes) at byte offset `0`, but there are only four total bytes in the buffer.

```ts
dv.setFloat64(0, 3.1415);
// ^ RangeError: Out of bounds access
```

The following methods are available on `DataView`:

{% table %}

- Getters
- Setters

---

- [`getBigInt64()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView/getBigInt64)
- [`setBigInt64()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView/setBigInt64)

---

- [`getBigUint64()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView/getBigUint64)
- [`setBigUint64()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView/setBigUint64)

---

- [`getFloat32()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView/getFloat32)
- [`setFloat32()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView/setFloat32)

---

- [`getFloat64()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView/getFloat64)
- [`setFloat64()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView/setFloat64)

---

- [`getInt16()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView/getInt16)
- [`setInt16()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView/setInt16)

---

- [`getInt32()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView/getInt32)
- [`setInt32()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView/setInt32)

---

- [`getInt8()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView/getInt8)
- [`setInt8()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView/setInt8)

---

- [`getUint16()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView/getUint16)
- [`setUint16()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView/setUint16)

---

- [`getUint32()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView/getUint32)
- [`setUint32()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView/setUint32)

---

- [`getUint8()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView/getUint8)
- [`setUint8()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView/setUint8)

{% /table %}

## `Buffer`

Bun fully supports `Buffer`. `Buffer` is a Node.js API for working with binary data that pre-dates the introduction of typed arrays in the JavaScript spec. It has since been re-implemented as a subclass of `Uint8Array` with a wide array of additional methods.

{% table %}

- From / To
- `ArrayBuffer`
- `TypedArray`
- `DataView`
- `Buffer`
- `string`
- `number[]`

---

- `ArrayBuffer`
- n/a
- `new Uint8Array(buf)`
- `new Uint8Array(buf)`
- not well-defined

{% /table %}

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
