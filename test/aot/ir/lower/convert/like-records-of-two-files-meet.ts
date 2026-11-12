// Two files declare a record each. That of the other file has every name of this one's and one more, and a value of it is cast to the type of this file.
// The cast puts the wider layout below the narrower one, and not the narrower below the wider. The other half: like-records-of-two-files-never-meet.ts.

// RUN(BELOW): link
// BELOW: layout {{*}}fields=[{key="likeExtra"{{*}}key="likeId"{{*}}supertypes=[

// RUN(ABOVE): link
// ABOVE-NOT: layout {{*}}fields=[{key="likeId"{{*}}supertypes=
import { make } from "./imports/like-record-that-is-handed-over";

interface Item {
  likeId: number;
  likeName: string;
}

const narrow = make(1) as Item;
console.log(narrow.likeName);
