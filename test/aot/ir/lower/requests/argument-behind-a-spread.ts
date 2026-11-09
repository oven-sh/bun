// RUN: link
// CHECK: layout {{*}}name="Oak"
// CHECK-NOT: supertypes=
// CHECK: layout

// RUN(FERN): link
// FERN: layout {{*}}name="Fern"
// FERN-NOT: supertypes=
// FERN: layout

// An argument adds nothing to a family, behind a spread as anywhere: neither class declares that it implements Leaf or Root, so neither goes below one.
interface Leaf {
  size: number;
}

interface Root {
  name: string;
}

class Fern {
  size = 1;
}

class Oak {
  name = "oak";
}

function plant(...parts: [...Leaf[], Root]) {
  return parts.length;
}

export function grow(ferns: Fern[]) {
  return plant(...ferns, new Oak());
}
