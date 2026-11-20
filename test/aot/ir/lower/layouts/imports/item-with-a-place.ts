export interface Item {
  id: number;
  title: string;
}

export interface Wide extends Item {
  more: number;
}

export function make(): Item {
  return { id: 1, title: "a" };
}
