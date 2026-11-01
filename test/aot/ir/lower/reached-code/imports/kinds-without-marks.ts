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

function helperOfUnmarked(size: number): number {
  return size + 2;
}

export const Used = defineKind((instance, size) => {
  instance.run = () => usedHelper(size);
});

export const Unused = defineKind((instance, size) => {
  instance.run = () => helperOfUnmarked(size);
});
