interface Item {
  likeId: number;
  likeName: string;
  likeExtra: number;
}

export function count(id: number): number {
  const items: Item[] = [];
  items.push({ likeId: id, likeName: "m" + id, likeExtra: id });
  return items.length;
}
