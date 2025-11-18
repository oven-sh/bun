import * as b from "bindgenv2";

export const SnapshotSerializerOptions = b.dictionary(
  {
    name: "SnapshotSerializerOptions",
    userFacingName: "SnapshotSerializerOptions",
    generateConversionFunction: true,
  },
  {
    test: {
      type: b.RawAny,
      required: true,
      internalName: "test_fn",
    },
    serialize: {
      type: b.RawAny,
      optional: true,
      internalName: "serialize_fn",
    },
    print: {
      type: b.RawAny,
      optional: true,
      internalName: "print_fn",
    },
  },
);
