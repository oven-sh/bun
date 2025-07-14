import { test, expect } from "bun:test";

test("basic snapshot serializer test", () => {
  const serializer = {
    test(val) {
      return val && val.type === 'custom';
    },
    serialize(val, printer) {
      return `CustomType(${val.name})`;
    },
  };

  expect.addSnapshotSerializer(serializer);

  const obj = { type: 'custom', name: 'test' };
  expect(obj).toMatchSnapshot();
});