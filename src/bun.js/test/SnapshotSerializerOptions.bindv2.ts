import * as b from "bindgenv2";

export const SnapshotSerializerOptions = b.dictionary(
  {
    name: "SnapshotSerializerOptions",
    generateConversionFunction: true,
  },
  {
    test: {
      type: b.RawAny,
      internalName: "test_fn",
    },
    serialize: {
      type: b.RawAny,
      internalName: "serialize_fn",
    },
    print: {
      type: b.RawAny,
      internalName: "print_fn",
    },
  },
);
