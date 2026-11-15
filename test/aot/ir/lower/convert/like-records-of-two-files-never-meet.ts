// Two files declare a record each. That of the other file has every name of this one's and one more, and no value of either file reaches the other.
// A family is what the program declares, and nothing here declares one of the other, so link puts neither layout below the other.

// RUN(NARROW): link
// NARROW: layout {{*}}fields=[{key="likeId"{{*}}{key="likeName"

// RUN(WIDE): link
// WIDE: layout {{*}}fields=[{key="likeExtra"{{*}}{key="likeId"{{*}}{key="likeName"

// RUN(APART): link
// APART-NOT: layout {{*}}key="likeId"{{*}}supertypes=
import { count } from "./imports/like-record-with-one-more-name";

interface Item {
  likeId: number;
  likeName: string;
}

function make(id: number): Item[] {
  const items: Item[] = [];
  items.push({ likeId: id, likeName: "n" + id });
  return items;
}

console.log(make(1).length + count(2));
