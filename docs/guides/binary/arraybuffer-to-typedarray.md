---
name: Convert an ArrayBuffer to a Uint8Array
---

A `Uint8Array` is a _typed array_, meaning it is a mechanism for viewing the data in an underlying `ArrayBuffer`.

```ts
const buffer = new ArrayBuffer(64);
const arr = new Uint8Array(buffer);
```

---

Instances of other typed arrays can be created similarly.

```ts
const buffer = new ArrayBuffer(64);

const arr1 = new Uint8Array(buffer);
const arr2 = new Uint16Array(buffer);
const arr3 = new Uint32Array(buffer);
const arr4 = new Float32Array(buffer);
const arr5 = new Float64Array(buffer);
const arr6 = new BigInt64Array(buffer);
const arr7 = new BigUint64Array(buffer);
```

---

To create a typed array that only views a portion of the underlying buffer, pass the offset and length to the constructor.

```ts
const buffer = new ArrayBuffer(64);
const arr = new Uint8Array(buffer, 0, 16); // view first 16 bytes
```

---

See [Docs > API > Utils](https://bun.com/docs/api/utils) for more useful utilities.
