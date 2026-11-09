interface Item {
  likeId: number;
  likeName: string;
  likeExtra: number;
}

export function make(id: number): Item {
  return { likeId: id, likeName: "m" + id, likeExtra: id };
}
