// The reference is `bun <file>`: a bundle has no dead zones, and the executable that `bun build --compile` makes without --aot reads undefined.
import "./owner.mjs";
