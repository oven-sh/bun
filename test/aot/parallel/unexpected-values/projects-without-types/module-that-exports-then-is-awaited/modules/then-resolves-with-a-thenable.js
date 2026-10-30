export function then(resolve) {
  resolve({
    then(inner) {
      inner({ value: { length: "from the inner thenable" } });
    },
  });
}
