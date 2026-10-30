interface Unused { x: number }

export function thrower(message: string): never {
  const error = new Error(message);
  throw error;
}
