interface Instance {
  run(): number;
}

type Initializer = (instance: Instance, size: number) => void;

function defineKind(initializer: Initializer): new (size: number) => Instance {
  function Kind(this: Instance, size: number) {
    initializer(this, size);
  }
  return Kind as unknown as new (size: number) => Instance;
}

function usedHelper(size: number): number {
  return size + 1;
}

function unusedHelper(size: number): number {
  return size + 2;
}

export const Used = /* @__PURE__ */ defineKind((instance, size) => {
  instance.run = () => usedHelper(size);
});

export const Unused = /* @__PURE__ */ defineKind((instance, size) => {
  instance.run = () => unusedHelper(size);
});
