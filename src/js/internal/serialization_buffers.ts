// Buffer tagging for JSC-serialized transports (advanced IPC, node:v8). JSC has no host-object hook,
// so we ship a [value, buffers] envelope (identity-aliased) and restore Buffer prototypes on receive.
// Node ref: https://github.com/nodejs/node/blob/main/lib/internal/child_process/serialization.js

const { Buffer } = require("node:buffer");
const BufferPrototype = Buffer.prototype;
const isBuffer = Buffer.isBuffer;
const ObjectKeys = Object.keys;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectSetPrototypeOf = Object.setPrototypeOf;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const SafeSet = Set;

/** Returns null when `value` holds no Buffers, else the [value, buffers] envelope. */
function tagBuffers(value: unknown): [unknown, unknown[]] | null {
  let buffers: unknown[] | null = null;
  let visited: Set<object> | null = null;
  const stack = [value];
  while (stack.length !== 0) {
    const current = stack[stack.length - 1];
    stack.length--;
    if (current === null || typeof current !== "object") continue;
    visited ??= new SafeSet();
    if (visited.$has(current)) continue;
    visited.$add(current);
    if ($isTypedArrayView(current)) {
      if (isBuffer(current)) $arrayPush((buffers ??= []), current);
      // Other ArrayBuffer views round-trip with their type already.
      continue;
    }
    if ($isMap(current)) {
      current.$forEach((entry, key) => {
        $arrayPush(stack, key);
        $arrayPush(stack, entry);
      });
      continue;
    }
    if ($isSet(current)) {
      current.$forEach(entry => $arrayPush(stack, entry));
      continue;
    }
    // Objects, arrays and errors: the serializer walks own enumerable
    // properties. Only data properties are descended so no getter runs here.
    const keys = ObjectKeys(current);
    for (let i = 0; i < keys.length; i++) {
      const desc = ObjectGetOwnPropertyDescriptor(current, keys[i]);
      if (desc && ObjectPrototypeHasOwnProperty.$call(desc, "value")) $arrayPush(stack, desc.value);
    }
  }
  return buffers === null ? null : [value, buffers];
}

/**
 * Receive side: restore the Buffer prototype on the envelope's aliased views
 * and hand back the value. The envelope came off a wire or byte blob, so its
 * shape is validated before it is trusted.
 */
function restoreBuffers(envelope: unknown): unknown {
  if (!$isJSArray(envelope) || (envelope as unknown[]).length !== 2 || !$isJSArray((envelope as unknown[])[1])) {
    throw new Error("failed to parse serialized buffer envelope");
  }
  const buffers = (envelope as unknown[])[1] as unknown[];
  for (let i = 0; i < buffers.length; i++) {
    const view = buffers[i];
    // Fresh from deserialization: plain Uint8Arrays the sender tagged.
    if ($isTypedArrayView(view)) ObjectSetPrototypeOf(view, BufferPrototype);
  }
  return (envelope as unknown[])[0];
}

export default { tagBuffers, restoreBuffers };
