export * from "crypto-browserify";

// we deliberately reference crypto. directly here because we want to preserve the This binding
export const getRandomValues = (array) => {
  return crypto.getRandomValues(array);
};

export const randomUUID = () => {
  return crypto.randomUUID();
};

export const timingSafeEqual =
  "timingSafeEqual" in crypto
    ? (a, b) => {
        const { byteLength: byteLengthA } = a;
        const { byteLength: byteLengthB } = b;
        if (
          typeof byteLengthA !== "number" ||
          typeof byteLengthB !== "number"
        ) {
          throw new TypeError("Input must be an array buffer view");
        }

        if (byteLengthA !== byteLengthB) {
          throw new RangeError("Input buffers must have the same length");
        }

        return crypto.timingSafeEqual(a, b);
      }
    : undefined;

if (timingSafeEqual) {
  // hide it from stack trace
  Object.defineProperty(timingSafeEqual, "name", {
    value: "::bunternal::",
  });
}

export const webcrypto = crypto;
