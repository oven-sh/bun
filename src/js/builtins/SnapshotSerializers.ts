// Iterates through snapshot serializers and returns the serialized value or null
// This is implemented in JavaScript to avoid deoptimization around JS/C++ boundaries
export function serialize(
  testCallbacks: Function[],
  serializeCallbacks: Function[],
  value: unknown,
): string | undefined {
  // Iterate through serializers in reverse order (most recent to least recent)
  for (let i = testCallbacks.length - 1; i >= 0; i--) {
    const testCallback = testCallbacks[i];

    // Call the test function with the value
    if (!testCallback(value)) {
      continue;
    }

    // Use this serializer
    const serializeCallback = serializeCallbacks[i];
    const result = serializeCallback(value);

    // Error if the result is not a string
    if (typeof result !== "string") {
      throw new TypeError("Snapshot serializer serialize callback must return a string");
    }

    return result;
  }

  // No matching serializer found
  return undefined;
}
